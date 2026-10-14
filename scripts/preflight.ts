// Deployment preflight. Verifies every environment variable the app needs by
// actually USING it — connects to Postgres, writes a probe file to UPLOAD_DIR,
// authenticates against the Anthropic API, and authenticates against SMTP.
//
//   npm run preflight
//
// Exits 1 if a REQUIRED check fails, 0 otherwise (optional features that are
// switched off are reported as warnings, not failures — that's a valid deploy).
//
// Run this on the SERVER after setting the environment, not on a laptop: the
// point is to prove the server's own config works. A green run means the app
// will start with every feature live; a warning means that feature is off.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";

// Same env resolution as the other scripts: real environment first, then .env.
function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) { const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m")); if (m) return m[1]; }
  return fallback;
}

type Status = "pass" | "warn" | "fail";
const results: { name: string; status: Status; detail: string }[] = [];
const record = (name: string, status: Status, detail: string) => {
  const icon = status === "pass" ? "  OK  " : status === "warn" ? " WARN " : " FAIL ";
  console.log(`[${icon}] ${name} — ${detail}`);
  results.push({ name, status, detail });
};

// ── Database (required) ──────────────────────────────────────
async function checkDatabase() {
  const url = fromEnv("DATABASE_URL");
  if (!url) return record("DATABASE_URL", "fail", "not set — the app cannot start");
  if (url.includes("CHANGE_ME")) return record("DATABASE_URL", "fail", "still contains the CHANGE_ME placeholder");
  process.env.DATABASE_URL = url;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Schema populated? Counting tables avoids depending on any model name.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`;
    const tables = Number(rows[0]?.n ?? 0);
    if (tables === 0) record("DATABASE_URL", "fail", "connected, but the schema is empty — run `npx prisma migrate deploy` or restore the dump");
    else record("DATABASE_URL", "pass", `connected; ${tables} tables in the public schema`);
  } catch (err) {
    record("DATABASE_URL", "fail", `cannot connect — ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}`);
  } finally {
    await prisma.$disconnect();
  }
}

// ── Auth (required) ──────────────────────────────────────────
function checkAuth() {
  const secret = fromEnv("NEXTAUTH_SECRET");
  if (!secret) record("NEXTAUTH_SECRET", "fail", "not set — sessions cannot be signed");
  else if (secret.length < 32 || secret.startsWith("replace-with")) record("NEXTAUTH_SECRET", "fail", "still the placeholder, or too short — use `openssl rand -base64 32`");
  else record("NEXTAUTH_SECRET", "pass", `set (${secret.length} chars)`);

  const url = fromEnv("NEXTAUTH_URL");
  if (!url) record("NEXTAUTH_URL", "fail", "not set — login redirects and email links will break");
  else if (!url.startsWith("https://") && !url.includes("localhost")) record("NEXTAUTH_URL", "warn", `${url} is not https — cookies may be rejected in production`);
  else record("NEXTAUTH_URL", "pass", url);
}

// ── File storage (required) ──────────────────────────────────
async function checkUploadDir() {
  const dir = path.resolve(fromEnv("UPLOAD_DIR", "./uploads"));
  if (!path.isAbsolute(fromEnv("UPLOAD_DIR", "./uploads"))) {
    record("UPLOAD_DIR", "warn", `relative path resolved to ${dir} — use an absolute path in production so it doesn't move with the working directory`);
  }
  const probe = path.join(dir, `.preflight-${process.pid}`);
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(probe, "probe");
    await fsp.unlink(probe);
    const entries = await fsp.readdir(dir);
    record("UPLOAD_DIR", "pass", `${dir} is writable; ${entries.length} entries present`);
  } catch (err) {
    record("UPLOAD_DIR", "fail", `${dir} is not writable — ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

// ── Anthropic (optional — EID auto-fill) ─────────────────────
// Retrieving the model validates the key AND confirms the configured model is
// available to this account. Costs nothing: no tokens are generated.
async function checkAnthropic() {
  const apiKey = fromEnv("ANTHROPIC_API_KEY").trim();
  const model = fromEnv("EID_OCR_MODEL", "claude-opus-5");
  if (!apiKey) return record("ANTHROPIC_API_KEY", "warn", "not set — EID auto-fill will show \"isn't configured yet\" and fall back to manual entry");
  if (apiKey.includes("xxxx")) return record("ANTHROPIC_API_KEY", "fail", "still the placeholder from .env.example");

  try {
    const info = await new Anthropic({ apiKey }).models.retrieve(model);
    record("ANTHROPIC_API_KEY", "pass", `key valid; ${info.display_name} (${info.id}) available for EID auto-fill`);
  } catch (err) {
    // Most specific first; APIConnectionError before APIError (it's a subclass in TS).
    if (err instanceof Anthropic.AuthenticationError) record("ANTHROPIC_API_KEY", "fail", "key rejected (401) — revoked or mistyped. Issue a new one at console.anthropic.com");
    else if (err instanceof Anthropic.PermissionDeniedError) record("ANTHROPIC_API_KEY", "fail", `key valid but not permitted to use ${model} (403) — check the workspace it belongs to`);
    else if (err instanceof Anthropic.NotFoundError) record("EID_OCR_MODEL", "fail", `model "${model}" not found (404) — check the spelling; the default is claude-opus-5`);
    else if (err instanceof Anthropic.RateLimitError) record("ANTHROPIC_API_KEY", "warn", "key valid but rate-limited (429) right now — retry shortly");
    else if (err instanceof Anthropic.APIConnectionError) record("ANTHROPIC_API_KEY", "fail", "cannot reach api.anthropic.com — outbound HTTPS blocked, or no DNS");
    else if (err instanceof Anthropic.APIError) record("ANTHROPIC_API_KEY", "fail", `API error ${err.status} — ${err.message}`);
    else record("ANTHROPIC_API_KEY", "fail", err instanceof Error ? err.message : "unknown error");
  }
}

// ── SMTP (optional — expiry-escalation emails) ───────────────
// verify() runs the full handshake (STARTTLS + AUTH) and sends no mail. Built
// the same way as src/lib/mailer.ts so a pass here means the app will send.
async function checkSmtp() {
  const host = fromEnv("SMTP_HOST").trim();
  const port = Number(fromEnv("SMTP_PORT", "587"));
  const user = fromEnv("SMTP_USER");
  const pass = fromEnv("SMTP_PASS");
  const from = fromEnv("SMTP_FROM", "BME MIS <no-reply@bmeventsksa.com>");

  if (!host) return record("SMTP_HOST", "warn", "not set — escalation emails are written to the server log instead of sent");
  if (host.includes("@")) return record("SMTP_HOST", "fail", `"${host}" looks like an email address — this field wants a mail SERVER hostname (Gmail: smtp.gmail.com)`);
  if (host && !user) record("SMTP_USER", "fail", "SMTP_HOST is set but SMTP_USER is empty — mailer.ts then sends unauthenticated, which Gmail refuses");

  try {
    await nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: user ? { user, pass } : undefined,
    }).verify();
    record("SMTP", "pass", `${host}:${port} accepted ${user || "an unauthenticated connection"}`);

    // Gmail rewrites From unless it owns the address or has it verified as an alias.
    const fromAddr = from.match(/<([^>]+)>/)?.[1] ?? from;
    if (user && fromAddr.toLowerCase() !== user.toLowerCase()) {
      record("SMTP_FROM", "warn", `sending as ${fromAddr} while authenticated as ${user} — the provider will rewrite the From header unless ${fromAddr} is a verified "Send mail as" alias`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    // Distinguish "port blocked" from "credentials rejected" — the usual VPS trap.
    if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      record("SMTP", "fail", `cannot reach ${host}:${port} — ${msg}. Many VPS providers block outbound mail ports by default; ask the host to open TCP ${port}`);
    } else if (/auth|credential|535|534|password/i.test(msg)) {
      record("SMTP", "fail", `credentials rejected by ${host} — ${msg}. For Gmail this must be a 16-character app password, not the account login password`);
    } else {
      record("SMTP", "fail", `${host}:${port} — ${msg}`);
    }
  }
}

// ── Run ──────────────────────────────────────────────────────
// Wrapped in main() rather than using top-level await: tsx compiles this file to
// CommonJS, where top-level await is a syntax error, so the plain `await` form
// crashed the moment anyone followed DEPLOYMENT.md step 5.
async function main() {
  console.log("BME MIS — deployment preflight\n");
  await checkDatabase();
  checkAuth();
  await checkUploadDir();
  await checkAnthropic();
  await checkSmtp();

  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");
  console.log(`\n${results.length} checks — ${results.length - failed.length - warned.length} ok, ${warned.length} warning(s), ${failed.length} failure(s)`);

  if (warned.length) {
    console.log("\nWarnings (the app will run; these features are off or degraded):");
    for (const r of warned) console.log(`  - ${r.name}: ${r.detail}`);
  }
  if (failed.length) {
    console.log("\nFailures (fix before going live):");
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log("\nAll required checks passed.");
}

main().catch((err) => {
  console.error("\npreflight crashed:", err);
  process.exit(1);
});

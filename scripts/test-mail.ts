// Send ONE real email through the app's own mailer, to prove escalation emails
// will actually arrive. Use this after `npm run preflight` reports SMTP ok —
// preflight authenticates but sends nothing; this delivers.
//
//   npm run test:mail -- someone@example.com
//
// Goes through src/lib/mailer.ts, so whatever this does is exactly what the
// nightly expiry scan will do.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { sendMail } from "../src/lib/mailer";

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) { const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m")); if (m) return m[1]; }
  return fallback;
}

const to = process.argv.slice(2).find((a) => a.includes("@"));
if (!to) {
  console.error("Usage: npm run test:mail -- recipient@example.com");
  process.exit(1);
}

// mailer.ts builds its transporter lazily from process.env on first send, so
// populating these from .env first is enough — no need to touch the mailer.
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
  const v = fromEnv(k);
  if (v) process.env[k] = v;
}

if (!process.env.SMTP_HOST) {
  console.error("SMTP_HOST is not set — the mailer would log instead of sending. Configure SMTP first (see .env.example).");
  process.exit(1);
}

console.log(`Sending via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587} as ${process.env.SMTP_USER || "(unauthenticated)"}`);
console.log(`From: ${process.env.SMTP_FROM || "BME MIS <no-reply@bmeventsksa.com>"}`);
console.log(`To:   ${to}\n`);

const result = await sendMail({
  to,
  subject: "BME MIS — SMTP test",
  text: "This is a test message from BME MIS. If you received it, document-expiry escalation emails are working.",
  html: "<p>This is a test message from <strong>BME MIS</strong>.</p><p>If you received it, document-expiry escalation emails are working.</p>",
});

if (result.sent) {
  console.log("Accepted by the mail server.");
  console.log("Now check the inbox — and check spam, since a first message from a new sender often lands there.");
  console.log("Note the From address that actually arrived: if it differs from SMTP_FROM, the provider rewrote it.");
} else {
  console.error(`NOT sent — ${result.reason}`);
  process.exit(1);
}

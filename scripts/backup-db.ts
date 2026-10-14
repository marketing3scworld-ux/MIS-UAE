// Database backup (spec §11). Wraps pg_dump to write a timestamped custom-format
// dump into ./backups (gitignored — the dump contains PII). Keeps the newest 14.
//
//   npm run backup
//
// pg_dump must be reachable. If it isn't on PATH, point PG_DUMP at it, e.g.
//   $env:PG_DUMP="D:\pgsql\bin\pg_dump.exe"; npm run backup
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RETAIN = 14;

// tsx doesn't auto-load .env — read DATABASE_URL from the environment or .env.
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error("DATABASE_URL not found in the environment or .env");
}

async function main() {
  const url = new URL(loadDatabaseUrl());
  const host = url.hostname;
  const port = url.port || "5432";
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = url.pathname.replace(/^\//, "");

  const dir = path.resolve("backups");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(dir, `bme_mis-${stamp}.dump`);

  const pgDump = process.env.PG_DUMP || "pg_dump";
  console.log(`Backing up ${database} @ ${host}:${port} -> ${path.relative(process.cwd(), outFile)}`);

  const res = spawnSync(
    pgDump,
    ["-h", host, "-p", port, "-U", user, "-d", database, "-F", "c", "-f", outFile],
    { stdio: "inherit", env: { ...process.env, PGPASSWORD: password } },
  );

  if (res.error) {
    console.error(
      `Could not run "${pgDump}". Add PostgreSQL's bin to PATH, or set PG_DUMP to the full path ` +
        `(e.g. D:\\pgsql\\bin\\pg_dump.exe).`,
    );
    console.error(res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);

  // Retention — keep the newest RETAIN dumps.
  const dumps = (await fs.readdir(dir))
    .filter((f) => f.startsWith("bme_mis-") && f.endsWith(".dump"))
    .sort();
  const stale = dumps.slice(0, Math.max(0, dumps.length - RETAIN));
  for (const f of stale) await fs.rm(path.join(dir, f), { force: true });

  console.log(
    `Backup complete. ${dumps.length - stale.length} kept` +
      (stale.length ? `, ${stale.length} old dump(s) pruned.` : "."),
  );
  console.log(`Restore with:  pg_restore -h ${host} -p ${port} -U ${user} -d ${database} --clean "<file>"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

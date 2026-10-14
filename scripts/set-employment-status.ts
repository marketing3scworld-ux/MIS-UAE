// Set employmentStatus on specific staff numbers (the "No." column in the app).
// Use when a profile is listed Active but the person has actually exited / their
// document set is incomplete. Unlike mark-active.ts (which rewrites EVERY row from
// a spreadsheet) this touches only the ids you name.
//
//   npm run set:status -- 10 48 --inactive           # DRY RUN — shows what changes
//   npm run set:status -- 10 48 --inactive --apply   # backs up, then writes
//   npm run set:status -- 10 --active --apply        # put someone back
//
// Reversible: the previous values are written to backups/employment-before-<ts>.json.

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const toInactive = argv.includes("--inactive");
const toActive = argv.includes("--active");
const ids = argv.filter((a) => /^\d+$/.test(a)).map(Number);

if (!ids.length || toInactive === toActive) {
  console.error('usage: set:status -- <id...> (--inactive|--active) [--apply]');
  process.exit(1);
}
const target = toInactive ? "INACTIVE" : "ACTIVE";

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) {
    const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
    if (m) return m[1];
  }
  return fallback;
}
const DATABASE_URL = fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;

// eslint-disable-next-line import/first
import { PrismaClient, type EmploymentStatus } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.staff.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, employmentStatus: true },
    orderBy: { id: "asc" },
  });
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(id)) console.warn(`  !! staff #${id} does not exist — skipped`);

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing written"}  → ${target}`);
  for (const r of rows) {
    const change = r.employmentStatus === target ? "(already)" : `${r.employmentStatus} → ${target}`;
    console.log(`  #${String(r.id).padStart(4)}  ${r.fullName.padEnd(40)} ${change}`);
  }

  if (!APPLY) { console.log(`\n  Re-run with --apply to write.\n`); return; }

  const dir = path.resolve("backups");
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `employment-before-${stamp}.json`);
  await fsp.writeFile(file, JSON.stringify(rows, null, 2), "utf8");

  const res = await prisma.staff.updateMany({
    where: { id: { in: [...found] } },
    data: { employmentStatus: target as EmploymentStatus },
  });
  console.log(`\n  updated ${res.count} row(s)`);
  console.log(`  backup: backups/employment-before-${stamp}.json\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

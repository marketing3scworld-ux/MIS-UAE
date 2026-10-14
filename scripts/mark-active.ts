// Mark the "completed documents" staff ACTIVE (by EID from the Excel) and everyone
// else INACTIVE. This drives the whole app: the dashboard, the expiry report, and
// alerts all key off employmentStatus=ACTIVE.
//
//   npm run mark:active -- "data/<completed>.xlsx"          # DRY RUN — counts only
//   npm run mark:active -- "data/<completed>.xlsx" --apply  # backs up, then updates
//
// Reversible: to make everyone Active again, run a plain updateMany, or restore from
// the backup written to backups/.

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!fileArg) { console.error('usage: mark:active -- "<completed>.xlsx" [--apply]'); process.exit(1); }

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) { const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m")); if (m) return m[1]; }
  return fallback;
}
const DATABASE_URL = fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;

// eslint-disable-next-line import/first
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const cellStr = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") { const o = v as Record<string, unknown>; if ("result" in o) return cellStr(o.result); if ("text" in o) return cellStr(o.text); }
  return String(v).replace(/\s+/g, " ").trim();
};

async function main() {
  const file = path.resolve(fileArg!);
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let eidCol = 0; ws.getRow(1).eachCell((c, col) => { if (cellStr(c.value).toUpperCase().includes("EID NUMBER")) eidCol = col; });
  if (!eidCol) throw new Error("EID NUMBER column not found");
  const activeEids = new Set<string>();
  for (let r = 2; r <= ws.rowCount; r++) { const e = cellStr(ws.getRow(r).getCell(eidCol).value); if (e) activeEids.add(e); }

  const total = await prisma.staff.count();
  const willBeActive = await prisma.staff.count({ where: { eidNumber: { in: [...activeEids] } } });
  const willBeInactive = total - willBeActive;

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing written"}`);
  console.log(`  EIDs in Excel (completed) : ${activeEids.size}`);
  console.log(`  total staff               : ${total}`);
  console.log(`  -> ACTIVE   (in Excel)    : ${willBeActive}`);
  console.log(`  -> INACTIVE (everyone else): ${willBeInactive}`);

  if (!APPLY) { console.log(`\n  Re-run with --apply to write.\n`); await prisma.$disconnect(); return; }

  // Backup current employmentStatus.
  const before = await prisma.staff.findMany({ select: { id: true, eidNumber: true, employmentStatus: true } });
  const dir = path.resolve("backups"); await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await fsp.writeFile(path.join(dir, `employment-before-${stamp}.json`), JSON.stringify(before, null, 2), "utf8");

  // Everyone inactive, then the completed set active.
  await prisma.staff.updateMany({ data: { employmentStatus: "INACTIVE" } });
  const act = await prisma.staff.updateMany({ where: { eidNumber: { in: [...activeEids] } }, data: { employmentStatus: "ACTIVE" } });

  const activeNow = await prisma.staff.count({ where: { employmentStatus: "ACTIVE" } });
  const inactiveNow = await prisma.staff.count({ where: { employmentStatus: "INACTIVE" } });
  console.log(`  set ACTIVE=${act.count}`);
  console.log(`  now: ACTIVE=${activeNow}  INACTIVE=${inactiveNow}`);
  console.log(`  backup: backups/employment-before-${stamp}.json\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

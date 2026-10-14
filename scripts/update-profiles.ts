// Update existing staff profiles from a "completed" Excel, matched by EID.
// import:staff is insert-only (skipDuplicates), so completed data for already-
// present staff (esp. document EXPIRY dates that drive the dashboard) never lands.
// This fills those fields WITHOUT nulling anything and WITHOUT renaming.
//
//   npm run update:profiles -- "data/<completed>.xlsx"            # DRY RUN — shows what would change
//   npm run update:profiles -- "data/<completed>.xlsx" --apply    # backs up, then updates + syncs doc expiries
//
// - Matches rows to staff by EID (the unique key). Rows whose EID isn't in the DB are skipped/reported.
// - Only NON-BLANK Excel values are written; blanks keep the existing value.
// - fullName and eidNumber are never changed.
// - After updating the 4 expiry columns, each current EID/OHC/BFHC/Passport document's
//   expiryDate is synced to the matching column (only where the doc's expiry is null).

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const APPLY = process.argv.includes("--apply");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!fileArg) { console.error('usage: update:profiles -- "<path.xlsx>" [--apply]'); process.exit(1); }

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
import { PrismaClient, Gender, type Prisma } from "@prisma/client";
const prisma = new PrismaClient();

// ── cell helpers (same conventions as import-staff) ──
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result;
    if ("text" in o) return o.text;
  }
  return v;
}
function str(v: unknown): string | null {
  const u = unwrap(v);
  if (u === null || u === undefined) return null;
  const s = String(u).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}
function upper(v: unknown): string | null { const s = str(v); return s ? s.toUpperCase() : null; }
function toDate(v: unknown): Date | null {
  const u = unwrap(v);
  if (u === null || u === undefined || u === "") return null;
  if (u instanceof Date) return new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  if (typeof u === "number") { const t = new Date((u - 25569) * 86400 * 1000); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); }
  const s = String(u).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { const day = +m[1], mon = +m[2], year = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return new Date(Date.UTC(year, mon - 1, day)); }
  const p = new Date(s); return isNaN(p.getTime()) ? null : new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
}
function normMobile(v: unknown): string | null {
  const raw = str(v); if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("971")) return "+" + s;
  if (s.startsWith("0")) return "+971" + s.slice(1);
  if (/^5\d{8}$/.test(s)) return "+971" + s;
  return raw;
}
function normGender(v: unknown): Gender | null { const s = upper(v); if (!s) return null; if (s.startsWith("M")) return Gender.MALE; if (s.startsWith("F")) return Gender.FEMALE; return null; }
const sameDay = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

async function main() {
  const file = path.resolve(fileArg!);
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const headers: Record<string, number> = {};
  ws.getRow(1).eachCell((c, col) => { const h = str(c.value); if (h) headers[h.toUpperCase()] = col; });
  const col = (needle: string) => { const k = Object.keys(headers).find((x) => x.includes(needle)); return k ? headers[k] : null; };
  const isPassNo = (k: string) => k.includes("PASSPORT") && (k.includes("#") || k.includes("NO") || k.includes("NUMBER"));
  const C = {
    name: col("FULL NAME"), eid: col("EID NUMBER"), mobile: col("MOBILE"),
    eidExp: col("EID EXPIRY"), ohc: col("OHC"), bfhc: col("BFHC"),
    passNo: Object.keys(headers).find(isPassNo) ? headers[Object.keys(headers).find(isPassNo)!] : null,
    passExp: (Object.keys(headers).find((k) => k.includes("PASSPORT") && k.includes("EXP")) && headers[Object.keys(headers).find((k) => k.includes("PASSPORT") && k.includes("EXP"))!]) ||
      (Object.keys(headers).find((k) => k.includes("PASSPORT") && !isPassNo(k)) ? headers[Object.keys(headers).find((k) => k.includes("PASSPORT") && !isPassNo(k))!] : null),
    gender: col("GENDER"), nationality: col("NATIONALITY"),
    location: col("STAFF LOCATION") ?? col("LOCATION"), category: col("CATEGORY"),
  };
  const cell = (row: ExcelJS.Row, c: number | null) => (c ? row.getCell(c).value : null);

  const byEid = await prisma.staff.findMany({ select: {
    id: true, eidNumber: true, fullName: true, mobileNumber: true, category: true, location: true,
    nationality: true, gender: true, passportNumber: true,
    eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true,
  } });
  const eidMap = new Map(byEid.filter((s) => s.eidNumber).map((s) => [s.eidNumber as string, s]));

  const changeCounts: Record<string, number> = {};
  const bump = (k: string) => (changeCounts[k] = (changeCounts[k] ?? 0) + 1);
  let matched = 0, notFound = 0, willUpdate = 0;
  const backup: unknown[] = [];
  const updates: { id: number; data: Prisma.StaffUpdateInput }[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const eid = str(cell(row, C.eid));
    if (!eid) continue;
    const s = eidMap.get(eid);
    if (!s) { notFound++; continue; }
    matched++;

    const data: Prisma.StaffUpdateInput = {};
    const setIf = <T,>(field: keyof Prisma.StaffUpdateInput, val: T | null, cur: T | null, label: string, eq: (a: T | null, b: T | null) => boolean = (a, b) => a === b) => {
      if (val !== null && val !== undefined && !eq(val, cur)) { (data as Record<string, unknown>)[field as string] = val; bump(label); }
    };
    setIf("eidExpiry", toDate(cell(row, C.eidExp)), s.eidExpiry, "eidExpiry", sameDay);
    setIf("ohcExpiry", toDate(cell(row, C.ohc)), s.ohcExpiry, "ohcExpiry", sameDay);
    setIf("bfhcExpiry", toDate(cell(row, C.bfhc)), s.bfhcExpiry, "bfhcExpiry", sameDay);
    setIf("passportExpiry", toDate(cell(row, C.passExp)), s.passportExpiry, "passportExpiry", sameDay);
    setIf("passportNumber", str(cell(row, C.passNo)), s.passportNumber, "passportNumber");
    setIf("mobileNumber", normMobile(cell(row, C.mobile)), s.mobileNumber, "mobile");
    setIf("gender", normGender(cell(row, C.gender)), s.gender, "gender");
    setIf("nationality", upper(cell(row, C.nationality)), s.nationality, "nationality");
    setIf("location", upper(cell(row, C.location)), s.location, "location");
    setIf("category", upper(cell(row, C.category)), s.category, "category");

    if (Object.keys(data).length) {
      willUpdate++;
      backup.push(s);
      updates.push({ id: s.id, data });
    }
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing written"}`);
  console.log(`  rows matched to staff (by EID) : ${matched}`);
  console.log(`  EID not in DB (skipped)        : ${notFound}`);
  console.log(`  staff that will change         : ${willUpdate}`);
  console.log(`  field changes:`);
  for (const [k, v] of Object.entries(changeCounts).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(16)} ${v}`);

  if (!APPLY) { console.log(`\n  Re-run with --apply to write these changes.\n`); await prisma.$disconnect(); return; }

  // Backup the pre-update state of the affected records.
  const dir = path.resolve("backups"); await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await fsp.writeFile(path.join(dir, `profiles-before-update-${stamp}.json`), JSON.stringify(backup, null, 2), "utf8");

  for (const u of updates) await prisma.staff.update({ where: { id: u.id }, data: u.data });

  // Sync current EID/OHC/BFHC/Passport document expiryDate to the (now-updated)
  // staff column, only where the document's expiry is still blank.
  const affected = await prisma.staff.findMany({ where: { id: { in: updates.map((u) => u.id) } }, select: { id: true, eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true } });
  const typeCol: [string, "eidExpiry" | "ohcExpiry" | "bfhcExpiry" | "passportExpiry"][] = [["EID_FRONT", "eidExpiry"], ["EID_BACK", "eidExpiry"], ["OHC", "ohcExpiry"], ["BFHC", "bfhcExpiry"], ["PASSPORT", "passportExpiry"]];
  let synced = 0;
  for (const s of affected) {
    for (const [type, colName] of typeCol) {
      const exp = s[colName];
      if (exp) {
        const res = await prisma.staffDocument.updateMany({ where: { staffId: s.id, type: type as never, isCurrent: true, expiryDate: null }, data: { expiryDate: exp } });
        synced += res.count;
      }
    }
  }
  console.log(`  updated ${updates.length} staff · synced ${synced} document expiry date(s)`);
  console.log(`  backup: backups/profiles-before-update-${stamp}.json\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

// Rerunnable staff import (spec §10).
//
//   npm run import:staff -- "data/STAFF DATEBASE-MASTER LIST 2026.xlsx" [--wipe]
//
// Handling rules (from inspecting the real file):
//  - Dates arrive as Excel Dates/serials -> converted, normalized to UTC date-only.
//  - Two passport columns: "Passport #" = passport NUMBER; the bare "PASSPORT"
//    (or "PASSPORT EXPIRY") column = passport EXPIRY date. Matched separately so
//    the number is never mistaken for the expiry.
//  - Trim whitespace; uppercase names; collapse double spaces; blanks -> null.
//  - Skip + log rows with no name or no EID (EID is the required unique key).
//  - Ignore the source MISSING/EXPIRED column (recomputed by the engine).
//  - Combined categories/locations (COMMIS/FOH, ATR/JCH) stored as-is.
//  - --wipe truncates staff tables first so the import can be rerun cleanly.
//  - Writes an import-report CSV (imported / skipped / warnings, with row numbers).

import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient, Gender, EmploymentStatus, ApprovalStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ---- cell helpers -----------------------------------------------------------

function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result; // formula cell
    if ("text" in o) return o.text; // rich text / hyperlink
  }
  return v;
}

function str(v: unknown): string | null {
  const u = unwrap(v);
  if (u === null || u === undefined) return null;
  const s = String(u).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function upper(v: unknown): string | null {
  const s = str(v);
  return s ? s.toUpperCase() : null;
}

/** Convert an Excel cell (Date | serial number | string) to a UTC date-only Date. */
function toDate(v: unknown, warn: (m: string) => void): Date | null {
  const u = unwrap(v);
  if (u === null || u === undefined || u === "") return null;
  let d: Date | null = null;
  if (u instanceof Date) {
    d = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  } else if (typeof u === "number") {
    // Excel 1900 date system: serial 25569 == 1970-01-01.
    const t = new Date((u - 25569) * 86400 * 1000);
    d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  } else {
    const s = String(u).trim();
    // Text dates in UAE locale: DD/MM/YYYY or DD-MM-YYYY (JS would misread these).
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const day = +m[1];
      const mon = +m[2];
      const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        d = new Date(Date.UTC(year, mon - 1, day));
      }
    }
    if (!d) {
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
      }
    }
  }
  if (!d || isNaN(d.getTime())) {
    warn(`unparseable date "${String(u)}"`);
    return null;
  }
  const y = d.getUTCFullYear();
  if (y < 1950 || y > 2100) warn(`suspicious date year ${y} ("${String(u)}")`);
  return d;
}

function normMobile(v: unknown): string | null {
  const raw = str(v);
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("971")) return "+" + s;
  if (s.startsWith("0")) return "+971" + s.slice(1);
  if (/^5\d{8}$/.test(s)) return "+971" + s;
  return raw; // leave legacy formats untouched rather than reject
}

function normGender(v: unknown): Gender | null {
  const s = upper(v);
  if (!s) return null;
  if (s.startsWith("M")) return Gender.MALE;
  if (s.startsWith("F")) return Gender.FEMALE;
  return null;
}

const EID_RE = /^784-\d{4}-\d{7}-\d$/;
const IBAN_RE = /^AE\d{21}$/;

// ---- main -------------------------------------------------------------------

type Skip = { row: number; eid: string; name: string; reason: string };
type Warn = { row: number; eid: string; name: string; detail: string };

async function main() {
  const argv = process.argv.slice(2);
  const wipe = argv.includes("--wipe");
  const fileArg = argv.find((a) => !a.startsWith("--"));
  if (!fileArg) throw new Error('usage: import:staff -- "<path.xlsx>" [--wipe]');
  const file = path.resolve(fileArg);
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  // Map headers -> column index (robust to reordering).
  const headers: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = str(cell.value);
    if (h) headers[h.toUpperCase()] = col;
  });
  const col = (needle: string): number | null => {
    const key = Object.keys(headers).find((k) => k.includes(needle));
    return key ? headers[key] : null;
  };
  const colBy = (pred: (k: string) => boolean): number | null => {
    const key = Object.keys(headers).find(pred);
    return key ? headers[key] : null;
  };
  // "Passport #"/"Passport No."/"Passport Number" -> number; anything else with
  // PASSPORT (bare "PASSPORT" or "PASSPORT EXPIRY") -> expiry date.
  const isPassportNumber = (k: string) =>
    k.includes("PASSPORT") && (k.includes("#") || k.includes("NO") || k.includes("NUMBER"));
  const C = {
    name: col("FULL NAME"),
    mobile: col("MOBILE"),
    eid: col("EID NUMBER"),
    eidExp: col("EID EXPIRY"),
    ohc: col("OHC"),
    bfhc: col("BFHC"),
    passportNumber: colBy(isPassportNumber),
    passportExpiry:
      colBy((k) => k.includes("PASSPORT") && k.includes("EXP")) ??
      colBy((k) => k.includes("PASSPORT") && !isPassportNumber(k)),
    gender: col("GENDER"),
    nationality: col("NATIONALITY"),
    location: col("STAFF LOCATION") ?? col("LOCATION"),
    category: col("CATEGORY"),
    bankTitle: col("BANK ACCOUNT TITLE"),
    iban: col("IBAN"),
    bankName: col("NAME OF BANK"),
  };
  const missingCols = Object.entries(C).filter(([, v]) => v == null).map(([k]) => k);
  if (missingCols.length) console.warn(`WARN: columns not found: ${missingCols.join(", ")}`);

  const cell = (row: ExcelJS.Row, c: number | null) => (c ? row.getCell(c).value : null);

  const records: {
    fullName: string;
    eidNumber: string;
    eidDigits: string;
    mobileNumber: string | null;
    eidExpiry: Date | null;
    ohcExpiry: Date | null;
    bfhcExpiry: Date | null;
    passportNumber: string | null;
    passportExpiry: Date | null;
    gender: Gender | null;
    nationality: string | null;
    location: string | null;
    category: string | null;
    bankAccountTitle: string | null;
    iban: string | null;
    bankName: string | null;
    employmentStatus: EmploymentStatus;
    approvalStatus: ApprovalStatus;
  }[] = [];

  const skips: Skip[] = [];
  const warns: Warn[] = [];
  const seenEid = new Set<string>();
  const cats = new Set<string>();
  const locs = new Set<string>();
  const nats = new Set<string>();
  const banks = new Set<string>();

  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const name = upper(cell(row, C.name));
    const eid = str(cell(row, C.eid));
    const w = (detail: string) => warns.push({ row: r, eid: eid ?? "", name: name ?? "", detail });

    if (!name && !eid) continue; // fully blank row
    if (!name) { skips.push({ row: r, eid: eid ?? "", name: "", reason: "no name" }); continue; }
    if (!eid) { skips.push({ row: r, eid: "", name, reason: "no EID" }); continue; }
    if (!EID_RE.test(eid)) w(`EID format not 784-YYYY-NNNNNNN-N ("${eid}")`);
    if (seenEid.has(eid)) { skips.push({ row: r, eid, name, reason: "duplicate EID in file" }); continue; }
    seenEid.add(eid);

    const category = upper(cell(row, C.category));
    const location = upper(cell(row, C.location));
    const nationality = upper(cell(row, C.nationality));
    const bankName = upper(cell(row, C.bankName));
    let iban = str(cell(row, C.iban));
    if (iban) {
      iban = iban.replace(/\s+/g, "").toUpperCase();
      if (!IBAN_RE.test(iban)) w(`IBAN not AE+21 digits ("${iban}") — kept anyway`);
    }
    if (category) cats.add(category);
    if (location) locs.add(location);
    if (nationality) nats.add(nationality);
    if (bankName) banks.add(bankName);

    records.push({
      fullName: name,
      eidNumber: eid,
      eidDigits: eid.replace(/\D/g, ""),
      mobileNumber: normMobile(cell(row, C.mobile)),
      eidExpiry: toDate(cell(row, C.eidExp), w),
      ohcExpiry: toDate(cell(row, C.ohc), w),
      bfhcExpiry: toDate(cell(row, C.bfhc), w),
      passportNumber: str(cell(row, C.passportNumber)),
      passportExpiry: toDate(cell(row, C.passportExpiry), w),
      gender: normGender(cell(row, C.gender)),
      nationality,
      location,
      category,
      bankAccountTitle: str(cell(row, C.bankTitle)),
      iban,
      bankName,
      employmentStatus: EmploymentStatus.ACTIVE,
      approvalStatus: ApprovalStatus.APPROVED, // real master-list data
    });
  }

  if (wipe) {
    console.log("--wipe: truncating Staff (cascade to documents/notifications)...");
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Staff" RESTART IDENTITY CASCADE;',
    );
  }

  // Insert in chunks (stay well under Postgres parameter limits).
  let imported = 0;
  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK);
    const res = await prisma.staff.createMany({ data: batch, skipDuplicates: true });
    imported += res.count;
  }
  const existedSkipped = records.length - imported;

  // Seed any new dropdown values found in the data (incl. combined values).
  const upsertOptions = async (
    model: { upsert: (a: { where: { value: string }; update: object; create: { value: string } }) => Promise<unknown> },
    values: Set<string>,
  ) => {
    for (const value of values) await model.upsert({ where: { value }, update: {}, create: { value } });
  };
  await upsertOptions(prisma.categoryOption, cats);
  await upsertOptions(prisma.locationOption, locs);
  await upsertOptions(prisma.nationalityOption, nats);
  await upsertOptions(prisma.bankOption, banks);

  // Write report CSV.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = path.resolve("import-reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `import-${stamp}.csv`);
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ["type,row,eid,name,detail"];
  for (const s of skips) lines.push(["SKIP", s.row, esc(s.eid), esc(s.name), esc(s.reason)].join(","));
  for (const wn of warns) lines.push(["WARN", wn.row, esc(wn.eid), esc(wn.name), esc(wn.detail)].join(","));
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

  const total = await prisma.staff.count();
  console.log("\n================ IMPORT REPORT ================");
  console.log(`Source file      : ${file}`);
  console.log(`Data rows read   : ${lastRow - 1}`);
  console.log(`Imported         : ${imported}`);
  console.log(`Skipped          : ${skips.length}  (${countReasons(skips)})`);
  if (existedSkipped > 0) console.log(`Already existed  : ${existedSkipped} (skipDuplicates)`);
  console.log(`Warnings         : ${warns.length}`);
  console.log(`New dropdown vals: ${cats.size} cat / ${locs.size} loc / ${nats.size} nat / ${banks.size} bank`);
  console.log(`Staff in DB now  : ${total}`);
  console.log(`Report CSV       : ${reportPath}`);
  console.log("==============================================\n");
}

function countReasons(skips: Skip[]): string {
  const m: Record<string, number> = {};
  for (const s of skips) m[s.reason] = (m[s.reason] ?? 0) + 1;
  return Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("IMPORT FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

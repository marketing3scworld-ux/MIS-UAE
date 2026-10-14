// Import staff from the attendance workbook as INCOMPLETE profiles (spec deviation,
// requested by the client). These people have no Emirates ID or document data in
// the source — only a name, and (from the timesheets) their most-common staff
// category and outlet/location. They are inserted as:
//   eidNumber = null, all expiry dates = null, employmentStatus = ACTIVE,
//   approvalStatus = PENDING
// so the expiry engine / dashboard / report flag every document as MISSING and
// each profile shows "No EID on file" until HR completes them.
//
//   npm run import:attendance -- "data/MASTER LIST ATTENDANCE LOG 2026.xlsx" [--reset]
//
//   --reset  first deletes existing shell records (eidNumber = null) so the
//            import can be re-run cleanly. The 354 EID-verified profiles are
//            never touched. (Shell documents cascade-delete with them.)
//
// Names with fewer than two alphabetic tokens (e.g. "XAVIER", "NISSAN") are
// skipped as unusable identifiers and listed in the report CSV for review.
import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient, EmploymentStatus, ApprovalStatus } from "@prisma/client";

const prisma = new PrismaClient();

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const twoTokens = (s: string) => clean(s).split(" ").filter((t) => /[A-Za-z]/.test(t)).length >= 2;

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o instanceof Date) return "";
    if ("result" in o) return cellStr(o.result);
    if ("text" in o) return cellStr(o.text);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

type Agg = { display: string; cat: Map<string, number>; loc: Map<string, number> };
const mode = (m: Map<string, number>): string | null => {
  let best: string | null = null;
  let bc = -1;
  for (const [k, c] of m) if (c > bc) { bc = c; best = k; }
  return best;
  
};

async function main() {
  const argv = process.argv.slice(2);
  const reset = argv.includes("--reset");
  const fileArg = argv.find((a) => !a.startsWith("--")) ?? "data/MASTER LIST ATTENDANCE LOG 2026.xlsx";
  const file = path.resolve(fileArg);
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const people = new Map<string, Agg>();
  const add = (name: string, cat: string | null, loc: string | null) => {
    const key = norm(name);
    if (!key) return;
    let a = people.get(key);
    if (!a) { a = { display: clean(name).toUpperCase(), cat: new Map(), loc: new Map() }; people.set(key, a); }
    else if (clean(name).length > a.display.length) a.display = clean(name).toUpperCase();
    if (cat) a.cat.set(cat.toUpperCase(), (a.cat.get(cat.toUpperCase()) ?? 0) + 1);
    if (loc) a.loc.set(loc.toUpperCase(), (a.loc.get(loc.toUpperCase()) ?? 0) + 1);
  };

  for (const ws of wb.worksheets) {
    if (ws.name.toUpperCase().includes("STAFF FULL")) {
      for (let r = 2; r <= ws.rowCount; r++) {
        ws.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
          if (col === 1) return;
          const s = cellStr(c.value);
          if (s) add(s, null, null);
        });
      }
      continue;
    }
    // Monthly attendance tab: locate the header row + relevant columns.
    let nameCol = 0, catCol = 0, locCol = 0, headerRow = 0;
    outer: for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        if (cellStr(row.getCell(c).value).toUpperCase() === "STAFF NAME") { headerRow = r; break outer; }
      }
    }
    if (!headerRow) continue;
    ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, col) => {
      const h = cellStr(c.value).toUpperCase();
      if (h === "STAFF NAME") nameCol = col;
      else if (h.includes("CATEGORY")) catCol = col;
      else if (h.includes("OUTLET") || h.includes("LOCATION")) locCol = col;
    });
    if (!nameCol) continue;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = cellStr(row.getCell(nameCol).value);
      if (!name) continue;
      add(name, catCol ? cellStr(row.getCell(catCol).value) || null : null, locCol ? cellStr(row.getCell(locCol).value) || null : null);
    }
  }

  // Existing profiles (dedupe by normalized name so we never duplicate the 354).
  const existing = await prisma.staff.findMany({ select: { fullName: true } });
  const existingNames = new Set(existing.map((s) => norm(s.fullName)));

  const skippedPartial: string[] = [];
  const skippedExisting: string[] = [];
  const toInsert: { fullName: string; category: string | null; location: string | null }[] = [];

  for (const [key, a] of people) {
    if (!twoTokens(a.display)) { skippedPartial.push(a.display); continue; }
    if (existingNames.has(key)) { skippedExisting.push(a.display); continue; }
    toInsert.push({ fullName: a.display, category: mode(a.cat), location: mode(a.loc) });
  }

  if (reset) {
    const del = await prisma.staff.deleteMany({ where: { eidNumber: null } });
    console.log(`--reset: removed ${del.count} existing shell record(s).`);
  }

  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const batch = toInsert.slice(i, i + CHUNK).map((r) => ({
      fullName: r.fullName,
      eidNumber: null,
      category: r.category,
      location: r.location,
      employmentStatus: EmploymentStatus.ACTIVE,
      approvalStatus: ApprovalStatus.PENDING,
    }));
    const res = await prisma.staff.createMany({ data: batch });
    inserted += res.count;
  }

  // Report CSV.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = path.resolve("import-reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `attendance-staff-${stamp}.csv`);
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["type,name"];
  for (const n of skippedPartial.sort()) lines.push(`SKIP_PARTIAL,${esc(n)}`);
  for (const n of skippedExisting.sort()) lines.push(`SKIP_ALREADY_PROFILED,${esc(n)}`);
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

  const total = await prisma.staff.count();
  console.log("\n=========== ATTENDANCE STAFF IMPORT ===========");
  console.log(`Distinct names in workbook   : ${people.size}`);
  console.log(`Skipped (single-word/partial): ${skippedPartial.length}`);
  console.log(`Skipped (already profiled)   : ${skippedExisting.length}`);
  console.log(`Inserted as incomplete shells: ${inserted}`);
  console.log(`Staff in DB now              : ${total}`);
  console.log(`Report CSV                   : ${reportPath}`);
  console.log("===============================================\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error("IMPORT FAILED:", e); await prisma.$disconnect(); process.exit(1); });

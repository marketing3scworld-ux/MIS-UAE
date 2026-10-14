// Build a fill-in spreadsheet for the staff who still have no bank details.
//
//   npm run make:iban-template
//
// Produces import-reports/IBAN-TO-FILL-<date>.xlsx with one row per staff member
// who is missing an IBAN, already carrying their Staff No. and EID Number. Fill in
// the IBAN / Mobile # and Name of Bank columns, then feed the same file back:
//
//   npm run import:ibans -- "import-reports/IBAN-TO-FILL-....xlsx" --apply
//
// Because the file carries the EID, the re-import matches exactly — no name
// guessing, which is what stopped the first pass at 267 of 354.
//
// The "Closest name in IBAN master list" column is a HINT only. It is filled from
// word overlap, which is not safe enough to import automatically: the source data
// contains pairs like "MD JOBAET HOSSAIN" and "MD KAWSAR HOSSAIN" that overlap
// heavily and are different people. Check each before trusting it.

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const argv = process.argv.slice(2);
const hintFile = argv.find((a) => !a.startsWith("--"))
  ?? "C:/Users/USER/Downloads/IBAN MASTER LIST.xlsx";

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) {
    const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
    if (m) return m[1];
  }
  return fallback;
}
process.env.DATABASE_URL = fromEnv("DATABASE_URL");

// eslint-disable-next-line import/first
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const cell = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cell(o.result);
    if ("text" in o) return cell(o.text);
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
  }
  return String(v).replace(/\s+/g, " ").trim();
};
const toks = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean));

async function main() {
  const blanks = await prisma.staff.findMany({
    where: { OR: [{ iban: null }, { iban: "" }] },
    select: { id: true, fullName: true, eidNumber: true, employmentStatus: true, category: true, location: true },
    orderBy: { id: "asc" },
  });

  // Optional hints from the IBAN master list.
  type Hint = { name: string; value: string; bank: string };
  const hints: Hint[] = [];
  if (existsSync(hintFile)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(hintFile);
    const ws = wb.worksheets[0];
    for (let r = 2; r <= ws.rowCount; r++) {
      const name = cell(ws.getRow(r).getCell(2).value);
      if (!name || /BENEFICIARY NAME/i.test(name)) continue;
      hints.push({ name, value: cell(ws.getRow(r).getCell(3).value), bank: cell(ws.getRow(r).getCell(4).value) });
    }
  }

  const out = new ExcelJS.Workbook();
  out.creator = "BME MIS";
  const ws = out.addWorksheet("Fill IBANs", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Staff No.", key: "id", width: 10 },
    { header: "FULL NAME AS PER EID", key: "name", width: 38 },
    { header: "EID Number", key: "eid", width: 22 },
    { header: "Status", key: "status", width: 10 },
    { header: "Category", key: "cat", width: 16 },
    { header: "Location", key: "loc", width: 20 },
    { header: "IBAN / Mobile #", key: "iban", width: 26 },
    { header: "Name of Bank", key: "bank", width: 28 },
    { header: "Closest name in IBAN master list (CHECK - hint only)", key: "hint", width: 46 },
    { header: "Its value", key: "hintVal", width: 24 },
  ];
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF184170" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });

  for (const s of blanks) {
    const st = toks(s.fullName);
    let best = { score: 0, hint: null as Hint | null };
    for (const h of hints) {
      const ht = toks(h.name);
      let shared = 0;
      for (const t of st) if (ht.has(t)) shared++;
      const score = shared / Math.max(st.size, ht.size);
      if (score > best.score) best = { score, hint: h };
    }
    const useHint = best.score >= 0.5 ? best.hint : null;
    ws.addRow({
      id: s.id,
      name: s.fullName,
      eid: s.eidNumber ?? "",
      status: s.employmentStatus === "ACTIVE" ? "Active" : "Inactive",
      cat: s.category ?? "",
      loc: s.location ?? "",
      iban: "",
      bank: "",
      hint: useHint ? `${useHint.name}  (${Math.round(best.score * 100)}% word match)` : "",
      hintVal: useHint ? useHint.value : "",
    });
  }
  // The two columns to type into.
  for (let r = 2; r <= ws.rowCount; r++) {
    for (const c of [7, 8]) {
      ws.getRow(r).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6D8" } };
    }
  }

  const dir = path.resolve("import-reports");
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `IBAN-TO-FILL-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await out.xlsx.writeFile(file);

  const withHint = ws.actualRowCount - 1;
  console.log(`\nstaff still missing bank details : ${blanks.length}`);
  console.log(`  active ${blanks.filter((b) => b.employmentStatus === "ACTIVE").length} / inactive ${blanks.filter((b) => b.employmentStatus === "INACTIVE").length}`);
  console.log(`  rows written                   : ${withHint}`);
  console.log(`\nwrote import-reports/${path.basename(file)}`);
  console.log(`\nFill the two yellow columns, then:`);
  console.log(`  npm run import:ibans -- "import-reports/${path.basename(file)}" --apply\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

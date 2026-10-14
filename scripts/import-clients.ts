// Import the customer list into Clients & events.
//
//   npm run import:clients -- "C:/path/Customer list - BME Dubai.xlsx"           # DRY RUN
//   npm run import:clients -- "C:/path/Customer list - BME Dubai.xlsx" --apply   # writes
//
// The sheet is one column of company names ("Customer"). Names are normalized the
// same way createClient() in src/app/(app)/clients/actions.ts does it — collapse
// whitespace, trim, uppercase — so a client typed into the UI and the same client
// imported here land on the identical row rather than creating a near-duplicate.
//
// EXISTING CLIENTS ARE LEFT ALONE. Client.name is unique, so a re-run simply adds
// whatever is new. A client that someone deliberately disabled stays disabled
// unless you pass --reactivate: an import silently re-enabling a client that was
// switched off on purpose is worse than a line in the report saying it was skipped.
//
// CLIENTS ONLY — this never creates events. Events are booked by hand on the
// Clients & events page as they come in, so inventing placeholder ones here would
// only put rows in the scheduling dropdown that nobody asked for.

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const REACTIVATE = argv.includes("--reactivate");
const fileArg = argv.find((a) => !a.startsWith("--"));
if (!fileArg) {
  console.error('usage: import:clients -- "<Customer list.xlsx>" [--apply] [--reactivate]');
  process.exit(1);
}

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

/** Exactly what createClient() stores, so UI-entered and imported names collide properly. */
const clientName = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/** Punctuation-blind key, used ONLY to warn about likely typo-duplicates. */
const squash = (s: string) => clientName(s).replace(/[^A-Z0-9]/g, "");

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type SheetRow = { name: string; row: number };

async function main() {
  const file = path.resolve(fileArg!);
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  // Locate the name column by header text rather than assuming column 1, so a sheet
  // that later gains an account-manager or trade-licence column still imports.
  const head = ws.getRow(1);
  let nameCol = 0;
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = cell(head.getCell(c).value).toUpperCase();
    if (/^(CUSTOMER|CLIENT|COMPANY|ACCOUNT)(\s*NAME)?$/.test(h) || h === "NAME") { nameCol = c; break; }
  }
  if (!nameCol) {
    // No recognizable header: fall back to column 1 if it looks like names.
    if (ws.columnCount === 1 && ws.rowCount > 1) nameCol = 1;
    else throw new Error(`could not find a Customer/Client name column in sheet "${ws.name}"`);
  }
  console.log(`  sheet                      : "${ws.name}"  name column ${nameCol}`);

  const rows: SheetRow[] = [];
  let blanks = 0, headerRepeats = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const raw = cell(ws.getRow(r).getCell(nameCol).value);
    if (!raw) { blanks++; continue; }
    if (/^(CUSTOMER|CLIENT|COMPANY|ACCOUNT|NAME)$/i.test(raw)) { headerRepeats++; continue; }
    rows.push({ name: clientName(raw), row: r });
  }

  // Duplicates inside the sheet itself.
  const seen = new Map<string, number>();
  const unique: SheetRow[] = [];
  const dupes: { name: string; row: number; firstRow: number }[] = [];
  for (const r of rows) {
    const prev = seen.get(r.name);
    if (prev !== undefined) { dupes.push({ name: r.name, row: r.row, firstRow: prev }); continue; }
    seen.set(r.name, r.row);
    unique.push(r);
  }

  const existing = await prisma.client.findMany({ select: { id: true, name: true, active: true } });
  const byName = new Map(existing.map((c) => [c.name, c]));

  const toCreate: SheetRow[] = [];
  const alreadyActive: SheetRow[] = [];
  const disabled: SheetRow[] = [];
  for (const r of unique) {
    const hit = byName.get(r.name);
    if (!hit) toCreate.push(r);
    else if (hit.active) alreadyActive.push(r);
    else disabled.push(r);
  }

  // Typo-duplicate warning: same letters and digits, different punctuation/spacing.
  // "RADISSON BLU" vs "RADISSON BLUE" is NOT caught here (different letters) and
  // must not be — they are three separate Radisson properties in this sheet.
  const bySquash = new Map<string, string[]>();
  for (const n of [...unique.map((u) => u.name), ...existing.map((e) => e.name)]) {
    const k = squash(n);
    const arr = bySquash.get(k) ?? [];
    if (!arr.includes(n)) arr.push(n);
    bySquash.set(k, arr);
  }
  const nearDupes = [...bySquash.values()].filter((v) => v.length > 1);

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing written"}`);
  console.log(`  rows with a name           : ${rows.length}  (skipped ${blanks} blank, ${headerRepeats} repeated header)`);
  console.log(`  distinct client names      : ${unique.length}${dupes.length ? `  (${dupes.length} duplicate row(s) in the sheet)` : ""}`);
  console.log(`  clients already in database: ${existing.length}`);
  console.log(`\n  TO CREATE                  : ${toCreate.length}`);
  console.log(`    already present, skipped : ${alreadyActive.length}`);
  console.log(`    present but DISABLED     : ${disabled.length}${disabled.length && !REACTIVATE ? "  (left disabled — pass --reactivate to switch on)" : REACTIVATE ? "  (will be re-enabled)" : ""}`);
  console.log(`  events created             : none — events are added by hand on /clients`);

  if (nearDupes.length) {
    console.log(`\n  ⚠ ${nearDupes.length} name(s) differing only in punctuation/spacing — check these:`);
    for (const g of nearDupes) console.log(`      ${g.map((x) => `"${x}"`).join("  vs  ")}`);
  }
  if (dupes.length) {
    console.log(`\n  duplicate rows in the sheet (second and later occurrences ignored):`);
    for (const d of dupes) console.log(`      row ${d.row} "${d.name}" (first seen row ${d.firstRow})`);
  }

  const reportDir = path.resolve("import-reports");
  await fsp.mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(reportDir, `client-import-${stamp}.csv`);
  const lines = ["action,sheet_row,client_name,note"];
  for (const r of toCreate) lines.push(["create", r.row, csvCell(r.name), ""].join(","));
  for (const r of alreadyActive) lines.push(["skip-exists", r.row, csvCell(r.name), ""].join(","));
  for (const r of disabled) lines.push([REACTIVATE ? "reactivate" : "skip-disabled", r.row, csvCell(r.name), "already in database but switched off"].join(","));
  for (const d of dupes) lines.push(["skip-duplicate-row", d.row, csvCell(d.name), `first seen row ${d.firstRow}`].join(","));
  for (const g of nearDupes) lines.push(["review-near-duplicate", "", csvCell(g.join(" | ")), "same letters, different punctuation"].join(","));
  await fsp.writeFile(reportPath, "\uFEFF" + lines.join("\r\n"), "utf8");
  console.log(`\n  report CSV: import-reports/${path.basename(reportPath)}`);

  if (!APPLY) { console.log(`\n  Re-run with --apply to write.\n`); return; }

  let created = 0, reactivated = 0;
  for (const r of toCreate) {
    await prisma.client.create({ data: { name: r.name } });
    created++;
  }
  if (REACTIVATE) {
    for (const r of disabled) {
      await prisma.client.update({ where: { name: r.name }, data: { active: true } });
      reactivated++;
    }
  }

  console.log(`\n  created ${created} client(s)`);
  if (REACTIVATE) console.log(`  re-enabled ${reactivated} client(s)`);
  console.log(`  report: import-reports/${path.basename(reportPath)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

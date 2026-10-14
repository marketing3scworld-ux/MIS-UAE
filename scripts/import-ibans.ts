// Import bank details (IBAN / mobile number + bank name) from the IBAN master list
// spreadsheet into each staff member's Bank Details section.
//
//   npm run import:ibans -- "C:/path/IBAN MASTER LIST.xlsx"           # DRY RUN
//   npm run import:ibans -- "C:/path/IBAN MASTER LIST.xlsx" --apply   # backs up, then writes
//
// MATCHING IS DELIBERATELY STRICT. The only key shared by the two sources is the
// person's name, and this is payroll data — a wrong match pays the wrong person.
// So a row is only written when the names match exactly, or contain exactly the
// same words in a different order ("ADEBISI ADEOLA DOLAPO" == "ADEOLA DOLAPO
// ADEBISI"). Partial overlaps are NEVER auto-applied: the sheet is full of pairs
// like "MD JOBAET HOSSAIN" and "MD KAWSAR HOSSAIN" that share two words out of
// three but are different people. Those are written to a review CSV instead.
//
// Column 3 of the sheet is "IBAN / Mobile #": staff paid through an exchange house
// have a mobile number there rather than an IBAN. Both are stored as-is, because
// that is the identifier payroll actually uses.

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
// Replacing a valid IBAN with a mobile number loses information; opt in explicitly.
const ALLOW_DOWNGRADE = argv.includes("--allow-iban-downgrade");
// Extra passes for names that differ in FORM but not in identity (see matchers below).
const FUZZY = argv.includes("--fuzzy");
const fileArg = argv.find((a) => !a.startsWith("--"));
if (!fileArg) {
  console.error('usage: import:ibans -- "<IBAN MASTER LIST.xlsx>" [--apply] [--fuzzy] [--allow-iban-downgrade]');
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

// The sheet contains Greek/Cyrillic look-alikes (e.g. "ΑΕ1303..." with a Greek
// Alpha+Epsilon), which would otherwise fail IBAN validation forever.
const deHomoglyph = (s: string) =>
  s.replace(/[ΑА]/g, "A").replace(/[ΕЕ]/g, "E").replace(/[ΟО]/g, "O").replace(/[ΡР]/g, "P")
   .replace(/[ΒВ]/g, "B").replace(/[ΗН]/g, "H").replace(/[ΚК]/g, "K").replace(/[ΜМ]/g, "M")
   .replace(/[ΤТ]/g, "T").replace(/[ΧХ]/g, "X").replace(/[ΙІ]/g, "I");

const norm = (s: string) => deHomoglyph(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const tokenKey = (s: string) => norm(s).split(" ").filter(Boolean).sort().join(" ");
const isIban = (v: string) => /^AE\d{21}$/i.test(v.replace(/\s+/g, ""));
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type SheetRow = { name: string; value: string; bank: string; row: number; eid?: string };

async function main() {
  const file = path.resolve(fileArg!);
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  // Locate columns by header text rather than fixed positions, so the same importer
  // handles the IBAN master list AND any sheet that adds an EID column.
  const head = ws.getRow(1);
  const col: { name?: number; value?: number; bank?: number; eid?: number } = {};
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = cell(head.getCell(c).value).toUpperCase();
    if (!h) continue;
    // "FULL NAME AS PER EID" also contains "EID", so a name header can never be
    // mistaken for the ID column.
    if (col.eid === undefined && /\b(EID|EMIRATES\s*ID)\b/.test(h) && !/NAME/.test(h)) col.eid = c;
    if (col.name === undefined && /BENEFICIARY|FULL NAME|^NAME$/.test(h)) col.name = c;
    if (col.value === undefined && /IBAN/.test(h)) col.value = c;
    if (col.bank === undefined && /NAME OF BANK|^BANK$/.test(h)) col.bank = c;
  }
  if (!col.name || !col.value) throw new Error(`could not find name/IBAN columns in "${ws.name}"`);
  console.log(`  columns detected           : name=${col.name} iban=${col.value} bank=${col.bank ?? "-"} eid=${col.eid ?? "none"}`);

  const rows: SheetRow[] = [];
  let headerRepeats = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const g = (c?: number) => (c ? cell(ws.getRow(r).getCell(c).value) : "");
    const name = g(col.name);
    if (!name) continue;
    if (/BENEFICIARY NAME|NAME OF BANK|IBAN\s*\/\s*MOBILE|FULL NAME/i.test(name)) { headerRepeats++; continue; }
    rows.push({
      name,
      value: deHomoglyph(g(col.value)).replace(/\s+/g, ""),
      bank: g(col.bank).toUpperCase().trim(),
      row: r,
      eid: g(col.eid).replace(/\D/g, ""),
    });
  }

  const staff = await prisma.staff.findMany({
    select: {
      id: true, fullName: true, iban: true, bankName: true, bankAccountTitle: true,
      eidNumber: true, eidDigits: true,
    },
    orderBy: { id: "asc" },
  });

  const byExact = new Map<string, typeof staff>();
  const byToken = new Map<string, typeof staff>();
  for (const s of staff) {
    const e = norm(s.fullName), t = tokenKey(s.fullName);
    byExact.set(e, [...(byExact.get(e) ?? []), s]);
    byToken.set(t, [...(byToken.get(t) ?? []), s]);
  }

  const used = new Set<number>();
  const matches: { s: (typeof staff)[number]; r: SheetRow; how: string }[] = [];
  const unmatchedRows: SheetRow[] = [];
  let ambiguous = 0;

  const claim = (cands: typeof staff, r: SheetRow, how: string) => {
    const free = cands.filter((c) => !used.has(c.id));
    if (free.length !== 1) return false;
    used.add(free[0].id);
    matches.push({ s: free[0], r, how });
    return true;
  };
  // EID is the only truly unambiguous key the two systems can share, so when the
  // sheet supplies one it wins outright — no name comparison, no judgement call.
  const byEid = new Map<string, (typeof staff)[number]>();
  for (const s of staff) {
    const d = s.eidDigits || (s.eidNumber ?? "").replace(/\D/g, "");
    if (d.length === 15) byEid.set(d, s);
  }

  const stillUnmatched: SheetRow[] = [];
  let eidMatched = 0;
  for (const r of rows) {
    if (r.eid && r.eid.length === 15) {
      const s = byEid.get(r.eid);
      if (s && !used.has(s.id)) {
        used.add(s.id);
        matches.push({ s, r, how: "eid" });
        eidMatched++;
        continue;
      }
    }
    const e = byExact.get(norm(r.name));
    if (e && claim(e, r, "exact")) continue;
    const t = byToken.get(tokenKey(r.name));
    if (t && claim(t, r, "reordered")) continue;
    if (e || t) { ambiguous++; continue; }
    stillUnmatched.push(r);
  }

  // ── Pass 3: SUBSET matching (only with --fuzzy) ────────────────────────────
  // The database stores the full EID name, which often carries the father's name
  // that the payroll sheet omits: "MD MARUF HASAN MD FARID UDDIN" vs "MD MARUF
  // HASAN". One token set is wholly contained in the other.
  //
  // Subset is used INSTEAD OF a similarity score on purpose. "MD JOBAET HOSSAIN"
  // and "MD KAWSAR HOSSAIN" share two of three words — high overlap, different
  // people — but neither is a subset of the other, so this rejects them. A word
  // present in one name and contradicted in the other always breaks the match.
  //
  // Tokens compare equal if identical, or one abbreviates the other: a single
  // letter matching an initial ("MICHELLE L CABUNYAG" / "MICHELLE LAGROSA
  // CABUNYAG"), or a truncation of >=4 characters ("ISLA" / "ISLAM", where the
  // database value was cut short on import).
  const tokEq = (a: string, b: string) => {
    if (a === b) return true;
    if (a.length === 1) return b.startsWith(a);
    if (b.length === 1) return a.startsWith(b);
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 4 && long.startsWith(short);
  };
  const subsetOf = (small: string[], big: string[]) => {
    const pool = [...big];
    for (const s of small) {
      const i = pool.findIndex((b) => tokEq(s, b));
      if (i === -1) return false;
      pool.splice(i, 1); // consume, so repeated words need repeated matches
    }
    return true;
  };

  let fuzzyMatched = 0, fuzzyAmbiguous = 0;
  if (FUZZY) {
    const free = () => staff.filter((s) => !used.has(s.id));
    // Build every candidate pair, then accept only those unique in BOTH directions.
    const cand = new Map<SheetRow, (typeof staff)[number][]>();
    const reverse = new Map<number, SheetRow[]>();
    for (const r of stillUnmatched) {
      const rt = norm(r.name).split(" ").filter(Boolean);
      const hits = free().filter((s) => {
        const st = norm(s.fullName).split(" ").filter(Boolean);
        return subsetOf(rt, st) || subsetOf(st, rt);
      });
      if (hits.length) {
        cand.set(r, hits);
        for (const h of hits) reverse.set(h.id, [...(reverse.get(h.id) ?? []), r]);
      }
    }
    for (const [r, hits] of cand) {
      // Exactly one staff for this row, and exactly one row for that staff.
      if (hits.length !== 1) { fuzzyAmbiguous++; continue; }
      const s = hits[0];
      if ((reverse.get(s.id) ?? []).length !== 1) { fuzzyAmbiguous++; continue; }
      if (used.has(s.id)) { fuzzyAmbiguous++; continue; }
      used.add(s.id);
      matches.push({ s, r, how: "subset" });
      fuzzyMatched++;
    }
    for (const r of stillUnmatched) {
      if (!matches.some((m) => m.r === r)) unmatchedRows.push(r);
    }
  } else {
    unmatchedRows.push(...stillUnmatched);
  }

  // Decide the write for each match.
  type Plan = { id: number; name: string; iban?: string; bankName?: string; bankAccountTitle?: string; note: string };
  const plans: Plan[] = [];
  let skippedBlank = 0, skippedDowngrade = 0, identical = 0;
  for (const m of matches) {
    const to = m.r.value.toUpperCase();
    if (!to) { skippedBlank++; continue; }
    const from = (m.s.iban ?? "").replace(/\s+/g, "").toUpperCase();
    if (from === to && (m.s.bankName ?? "") === m.r.bank) { identical++; continue; }
    if (from && isIban(from) && !isIban(to) && !ALLOW_DOWNGRADE) {
      skippedDowngrade++;
      continue;
    }
    plans.push({
      id: m.s.id,
      name: m.s.fullName,
      iban: to,
      bankName: m.r.bank || undefined,
      // Only fill the account title when it is blank — never clobber a curated one.
      bankAccountTitle: m.s.bankAccountTitle ? undefined : m.r.name.toUpperCase(),
      note: from ? "replaces" : "fills",
    });
  }

  const unmatchedStaff = staff.filter((s) => !used.has(s.id));
  const ibanCount = plans.filter((p) => isIban(p.iban!)).length;

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing written"}`);
  console.log(`  sheet people rows          : ${rows.length}  (skipped ${headerRepeats} repeated header)`);
  console.log(`  staff in database          : ${staff.length}`);
  console.log(`  matched 1:1                : ${matches.length}  (${eidMatched} by EID, ${matches.filter((m) => m.how === "exact").length} exact name, ${matches.filter((m) => m.how === "reordered").length} reordered, ${matches.filter((m) => m.how === "subset").length} subset)`);
  console.log(`  ambiguous, skipped         : ${ambiguous + fuzzyAmbiguous}`);
  if (FUZZY) {
    console.log(`\n  --fuzzy added ${fuzzyMatched} subset match(es); every one is listed here for audit:`);
    for (const m of matches.filter((x) => x.how === "subset")) {
      console.log(`    #${String(m.s.id).padStart(3)} ${m.s.fullName.slice(0, 36).padEnd(38)} <- r${String(m.r.row).padStart(3)} ${m.r.name}`);
    }
    console.log("");
  }
  console.log(`  sheet rows with no staff   : ${unmatchedRows.length}`);
  console.log(`  staff with no sheet row    : ${unmatchedStaff.length}`);
  console.log(`\n  TO WRITE                   : ${plans.length}   (${ibanCount} IBANs, ${plans.length - ibanCount} mobile numbers)`);
  console.log(`    already identical, skipped: ${identical}`);
  console.log(`    blank value, skipped      : ${skippedBlank}`);
  console.log(`    IBAN->mobile, skipped     : ${skippedDowngrade}${skippedDowngrade && !ALLOW_DOWNGRADE ? "  (pass --allow-iban-downgrade to include)" : ""}`);

  // Bank names the dropdown doesn't have yet.
  const existingBanks = new Set((await prisma.bankOption.findMany({ select: { value: true } })).map((b) => b.value.toUpperCase()));
  const newBanks = [...new Set(plans.map((p) => p.bankName).filter((b): b is string => !!b))].filter((b) => !existingBanks.has(b)).sort();
  console.log(`  new Bank dropdown values   : ${newBanks.length}`);

  // Review file for everything a human has to decide.
  const reportDir = path.resolve("import-reports");
  await fsp.mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(reportDir, `iban-import-${stamp}.csv`);
  const lines = ["type,staff_id,staff_name,sheet_row,sheet_name,value,bank"];
  for (const m of matches) lines.push(["matched-" + m.how, m.s.id, csvCell(m.s.fullName), m.r.row, csvCell(m.r.name), csvCell(m.r.value), csvCell(m.r.bank)].join(","));
  for (const s of unmatchedStaff) lines.push(["staff-not-in-sheet", s.id, csvCell(s.fullName), "", "", "", ""].join(","));
  for (const r of unmatchedRows) lines.push(["sheet-row-not-in-db", "", "", r.row, csvCell(r.name), csvCell(r.value), csvCell(r.bank)].join(","));
  await fsp.writeFile(reportPath, "\uFEFF" + lines.join("\r\n"), "utf8");
  console.log(`\n  review CSV: import-reports/${path.basename(reportPath)}`);

  if (!APPLY) { console.log(`\n  Re-run with --apply to write.\n`); return; }

  // Back up the current bank fields for every staff member we are about to touch.
  const backupDir = path.resolve("backups");
  await fsp.mkdir(backupDir, { recursive: true });
  const ids = plans.map((p) => p.id);
  const before = await prisma.staff.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, iban: true, bankName: true, bankAccountTitle: true },
  });
  const backupPath = path.join(backupDir, `bank-details-before-${stamp}.json`);
  await fsp.writeFile(backupPath, JSON.stringify(before, null, 2), "utf8");

  for (const b of newBanks) {
    await prisma.bankOption.upsert({ where: { value: b }, update: { active: true }, create: { value: b } });
  }

  let written = 0;
  for (const p of plans) {
    await prisma.staff.update({
      where: { id: p.id },
      data: {
        iban: p.iban,
        ...(p.bankName ? { bankName: p.bankName } : {}),
        ...(p.bankAccountTitle ? { bankAccountTitle: p.bankAccountTitle } : {}),
      },
    });
    written++;
  }
  console.log(`\n  updated ${written} staff`);
  console.log(`  added ${newBanks.length} bank dropdown value(s)`);
  console.log(`  backup: backups/${path.basename(backupPath)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

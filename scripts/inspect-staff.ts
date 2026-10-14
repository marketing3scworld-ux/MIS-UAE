// Throwaway inspection script (Step 2 prep): dumps the real structure of the
// staff master workbook so the Prisma schema and import mapping are written
// against actual columns/types, not assumptions.
//
//   npx tsx scripts/inspect-staff.ts "data/STAFF DATEBASE-MASTER LIST 2026.xlsx"

import ExcelJS from "exceljs";

function describe(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return `Date(${v.toISOString().slice(0, 10)})`;
  if (typeof v === "number") return `num:${v}`;
  if (typeof v === "object") return `obj:${JSON.stringify(v)}`;
  const s = String(v);
  return `str:"${s.length > 40 ? s.slice(0, 40) + "…" : s}"`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: tsx inspect-staff.ts <path-to-xlsx>");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  console.log("FILE:", file);
  console.log(
    "SHEETS:",
    wb.worksheets.map((w) => `${w.name} [${w.rowCount}r x ${w.columnCount}c]`).join(" | "),
  );

  const ws = wb.worksheets[0];
  console.log(`\n=== SHEET "${ws.name}" — ${ws.rowCount} rows x ${ws.columnCount} cols ===`);

  const maxRow = Math.min(ws.rowCount, 6);
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      cells.push(`[${c}] ${describe(row.getCell(c).value)}`);
    }
    console.log(`\nROW ${r}:`);
    console.log("  " + cells.join("\n  "));
  }

  // Non-empty row count (skip fully blank rows)
  let nonEmpty = 0;
  ws.eachRow({ includeEmpty: false }, () => nonEmpty++);
  console.log(`\nNON-EMPTY ROWS (incl header): ${nonEmpty}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

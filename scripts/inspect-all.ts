// Deep inspection of every worksheet in every given file: real data extent
// (rows with any value in the first columns), headers, and sample rows.
import ExcelJS from "exceljs";
import path from "node:path";

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.result ?? o.text ?? JSON.stringify(o));
  }
  return String(v);
}

async function main() {
  for (const f of process.argv.slice(2)) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(f);
    } catch (e) {
      console.log(`\n############ ${path.basename(f)} ############\n  ERROR: ${(e as Error).message}`);
      continue;
    }
    console.log(`\n############ ${path.basename(f)} ############`);
    console.log(`worksheets: ${wb.worksheets.map((w) => w.name).join(", ")}`);

    for (const ws of wb.worksheets) {
      const scanCols = Math.min(ws.columnCount || 6, 8);
      let realRows = 0, firstRow = 0, lastRow = 0;
      for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        let has = false;
        for (let c = 1; c <= scanCols; c++) {
          if (cellStr(row.getCell(c).value).trim() !== "") { has = true; break; }
        }
        if (has) { realRows++; if (!firstRow) firstRow = r; lastRow = r; }
      }
      console.log(
        `\n--- sheet "${ws.name}": rowCount=${ws.rowCount} colCount=${ws.columnCount} | REAL rows=${realRows} (rows ${firstRow}-${lastRow}) ---`,
      );
      const maxC = Math.min(ws.columnCount || 1, 20);
      const dump = (r: number, label: string) => {
        if (r < 1 || r > ws.rowCount) return;
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= maxC; c++) cells.push(`[${c}]${cellStr(row.getCell(c).value).slice(0, 22)}`);
        console.log(`${label} ${r}: ${cells.join(" | ")}`);
      };
      dump(firstRow || 1, "HEADER");
      dump((firstRow || 1) + 1, "row");
      dump((firstRow || 1) + 2, "row");
      dump(lastRow, "LAST");
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

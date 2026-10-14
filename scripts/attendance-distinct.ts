// How many DISTINCT people actually exist across the files? The attendance log's
// monthly sheets are attendance records (staff x days), not unique staff, so we
// dedupe names and cross-reference the master profile list.
import ExcelJS from "exceljs";

function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object"
    ? String((v as Record<string, unknown>).text ?? (v as Record<string, unknown>).result ?? "")
    : String(v);
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

async function main() {
  const dir = "data/";
  const master = new Set<string>();
  const mwb = new ExcelJS.Workbook();
  await mwb.xlsx.readFile(dir + "STAFF DATEBASE-MASTER LIST 2026.xlsx");
  const mws = mwb.worksheets[0];
  for (let r = 2; r <= mws.rowCount; r++) {
    const n = norm(mws.getRow(r).getCell(2).value);
    if (n) master.add(n);
  }

  const att = new Set<string>();
  let recordRows = 0;
  const awb = new ExcelJS.Workbook();
  await awb.xlsx.readFile(dir + "MASTER LIST ATTENDANCE LOG 2026.xlsx");
  for (const ws of awb.worksheets) {
    let nameCol = 0, hdr = 0;
    for (let r = 1; r <= Math.min(12, ws.rowCount) && !nameCol; r++) {
      for (let c = 1; c <= ws.columnCount; c++) {
        if (norm(ws.getRow(r).getCell(c).value) === "STAFF NAME") { nameCol = c; hdr = r; break; }
      }
    }
    if (!nameCol) continue;
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const n = norm(ws.getRow(r).getCell(nameCol).value);
      if (n && /[A-Z]/.test(n) && !n.startsWith("TOTAL")) { att.add(n); recordRows++; }
    }
  }

  const inBoth = [...master].filter((n) => att.has(n)).length;
  const attOnly = [...att].filter((n) => !master.has(n)).length;
  console.log("Master profile list — distinct names :", master.size);
  console.log("Attendance log — total record rows   :", recordRows);
  console.log("Attendance log — DISTINCT names      :", att.size);
  console.log("Names in BOTH (have a profile)       :", inBoth);
  console.log("In attendance but NOT in master      :", attOnly, "(worked, but no profile record)");
}

main().catch((e) => { console.error(e); process.exit(1); });

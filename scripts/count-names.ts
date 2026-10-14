// Diagnostic: how many rows actually carry a name / EID, and where data stops.
import ExcelJS from "exceljs";

async function main() {
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.argv[2]);
const ws = wb.worksheets[0];

let nameCol = 0;
let eidCol = 0;
ws.getRow(1).eachCell((c, i) => {
  const h = String(c.value ?? "").toUpperCase();
  if (h.includes("FULL NAME")) nameCol = i;
  if (h.includes("EID NUMBER")) eidCol = i;
});

const nonEmpty = (v: unknown) => v != null && String(v).trim() !== "";
let names = 0, eids = 0, firstName = 0, lastName = 0, lastEid = 0;
for (let r = 2; r <= ws.rowCount; r++) {
  const nv = ws.getRow(r).getCell(nameCol).value;
  const ev = ws.getRow(r).getCell(eidCol).value;
  if (nonEmpty(nv)) { names++; if (!firstName) firstName = r; lastName = r; }
  if (nonEmpty(ev)) { eids++; lastEid = r; }
}
console.log(`nameCol=${nameCol} eidCol=${eidCol} rowCount=${ws.rowCount}`);
console.log(`rowsWithName=${names} rowsWithEID=${eids} firstNameRow=${firstName} lastNameRow=${lastName} lastEidRow=${lastEid}`);
// sample a few rows near the end of the data block and just past it
for (const r of [firstName, lastName, lastName + 1, lastName + 2]) {
  if (r < 2) continue;
  const row = ws.getRow(r);
  console.log(`row ${r}: name=${JSON.stringify(row.getCell(nameCol).value)} eid=${JSON.stringify(row.getCell(eidCol).value)}`);
}
}

main();

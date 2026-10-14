import ExcelJS from "exceljs";

// One export engine for every Phase-2 report. Each report supplies columns + rows;
// this turns them into a branded workbook or a print-to-PDF page, so "exportable to
// Excel/PDF" behaves the same on all four without four copies of the plumbing.

export type ExportCol = { key: string; header: string; width?: number; numeric?: boolean };
export type ExportRow = Record<string, string | number | null | undefined>;

export type ExportDoc = {
  title: string;
  subtitle: string;
  cols: ExportCol[];
  rows: ExportRow[];
  /** Rendered as a totals strip under the title and as a bold last row in Excel. */
  totals?: ExportRow;
  filename: string;
};

const NAVY = "FF184170";

export async function xlsxResponse(doc: ExportDoc): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BME MIS";
  // Excel rejects * ? : \ / [ ] in a sheet name and caps it at 31 characters, so a
  // title like "Staff Working Hours / Payroll" has to be sanitised, not just cut.
  const sheetName = (doc.title.replace(/[*?:\/\[\]]/g, "-").trim().slice(0, 31)) || "Report";
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 3 }] });

  ws.mergeCells(1, 1, 1, Math.max(1, doc.cols.length));
  const t = ws.getCell(1, 1);
  t.value = doc.title;
  t.font = { bold: true, size: 14, color: { argb: NAVY } };

  ws.mergeCells(2, 1, 2, Math.max(1, doc.cols.length));
  const s = ws.getCell(2, 1);
  s.value = doc.subtitle;
  s.font = { size: 10, color: { argb: "FF64748B" } };

  const headerRow = ws.getRow(3);
  doc.cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", wrapText: true };
    ws.getColumn(i + 1).width = c.width ?? 16;
  });
  headerRow.height = 20;

  for (const r of doc.rows) {
    const row = ws.addRow(doc.cols.map((c) => r[c.key] ?? ""));
    doc.cols.forEach((c, i) => {
      if (c.numeric) row.getCell(i + 1).numFmt = "0.00";
    });
  }

  if (doc.totals) {
    const row = ws.addRow(doc.cols.map((c) => doc.totals![c.key] ?? ""));
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin", color: { argb: NAVY } } };
    });
    doc.cols.forEach((c, i) => {
      if (c.numeric) row.getCell(i + 1).numFmt = "0.00";
    });
  }

  const body = await wb.xlsx.writeBuffer();
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${doc.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Print-optimised HTML that opens the browser's print dialog — no PDF dependency. */
export function pdfResponse(doc: ExportDoc): Response {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const head = doc.cols.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = doc.rows
    .map((r) => `<tr>${doc.cols.map((c) => `<td class="${c.numeric ? "n" : ""}">${esc(r[c.key])}</td>`).join("")}</tr>`)
    .join("");
  const totals = doc.totals
    ? `<tfoot><tr>${doc.cols.map((c) => `<td class="${c.numeric ? "n" : ""}">${esc(doc.totals![c.key])}</td>`).join("")}</tr></tfoot>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f2440; margin: 0; padding: 20px; }
  .head { border-bottom: 2px solid #184170; padding-bottom: 8px; margin-bottom: 12px; }
  .head h1 { font-size: 16px; margin: 0; color: #184170; }
  .head p { font-size: 11px; color: #64748b; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  thead th { background: #184170; color: #fff; text-align: left; padding: 5px 6px; border: 1px solid #123256; }
  tbody td { padding: 4px 6px; border: 1px solid #dbe2ec; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f5f8fc; }
  tfoot td { padding: 5px 6px; border: 1px solid #dbe2ec; font-weight: bold; background: #eef2f8; }
  td.n { text-align: right; }
  .foot { margin-top: 10px; font-size: 10px; color: #94a3b8; text-align: right; }
  @media print { .hint { display: none; } }
  .hint { margin: 0 0 12px; font-size: 12px; color: #64748b; }
</style></head>
<body onload="window.print()">
  <p class="hint">Your print dialog should open automatically — choose “Save as PDF”. If not, press Ctrl/Cmd&nbsp;+&nbsp;P.</p>
  <div class="head"><h1>${esc(doc.title)}</h1><p>${esc(doc.subtitle)}</p></div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table>
  <div class="foot">Brilliant Minds Events LLC — Management Information System</div>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function exportResponse(doc: ExportDoc, format: string): Promise<Response> | Response {
  return format.toLowerCase() === "pdf" ? pdfResponse(doc) : xlsxResponse(doc);
}

import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { computeDocStatuses } from "@/lib/doc-status";
import { can } from "@/lib/rbac";
import {
  parseStaffParams, buildStaffWhere, buildStaffOrderBy, effectiveStatus,
} from "@/lib/staff-query";
import { formatDateUTC, titleCaseName, titleCaseLabel } from "@/lib/format";

// One column definition shared by every export format so Excel / CSV / PDF stay
// perfectly in sync (spec §8.2).
const COLS: { key: string; header: string; width: number }[] = [
  { key: "id", header: "No.", width: 6 },
  { key: "fullName", header: "Full Name", width: 30 },
  { key: "category", header: "Category", width: 16 },
  { key: "mobile", header: "Mobile", width: 16 },
  { key: "eid", header: "EID Number", width: 20 },
  { key: "eidExp", header: "EID Expiry", width: 13 },
  { key: "ohcExp", header: "OHC Expiry", width: 13 },
  { key: "bfhcExp", header: "BFHC Expiry", width: 13 },
  { key: "passExp", header: "Passport Expiry", width: 15 },
  { key: "gender", header: "Gender", width: 9 },
  { key: "nationality", header: "Nationality", width: 14 },
  { key: "location", header: "Location", width: 24 },
  { key: "status", header: "Status", width: 10 },
  { key: "bankTitle", header: "Bank Title", width: 22 },
  { key: "iban", header: "IBAN", width: 26 },
  { key: "bank", header: "Bank", width: 18 },
  { key: "docs", header: "Missing/Expired Documents", width: 30 },
];

type Row = Record<string, string | number>;

// Export the current filtered view. `?format=` chooses xlsx (default) | csv | pdf.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!can(session.user.role, "staff:viewAll")) return new Response("Forbidden", { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const p = parseStaffParams(sp);
  const format = (sp.format ?? "xlsx").toLowerCase();
  const { expiryWindowDays } = await getSettings();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);

  const where = buildStaffWhere(p, expiryWindowDays, now);
  const staff = await prisma.staff.findMany({ where, orderBy: buildStaffOrderBy(p.sort, p.dir) });

  // Which documents actually have a file. Without this the export computed every
  // status as if a file existed, so its "Missing/Expired Documents" column could
  // disagree with the same row on screen — and the derived Status needs it too.
  const staffIds = staff.map((s) => s.id);
  const docRows = staffIds.length
    ? await prisma.staffDocument.findMany({
        where: { staffId: { in: staffIds }, isCurrent: true },
        select: { staffId: true, type: true },
      })
    : [];
  const presence = new Map<number, Set<string>>();
  for (const d of docRows) {
    (presence.get(d.staffId) ?? presence.set(d.staffId, new Set()).get(d.staffId)!).add(d.type);
  }
  const filesFor = (id: number) => {
    const set = presence.get(id) ?? new Set<string>();
    return {
      eid: set.has("EID_FRONT") || set.has("EID_BACK"),
      ohc: set.has("OHC"),
      bfhc: set.has("BFHC"),
      passport: set.has("PASSPORT"),
    };
  };

  const rows: Row[] = staff.map((s) => {
    const docs = computeDocStatuses(s, expiryWindowDays, now, filesFor(s.id));
    return {
      id: s.id,
      fullName: titleCaseName(s.fullName),
      category: titleCaseLabel(s.category),
      mobile: s.mobileNumber ?? "",
      eid: s.eidNumber ?? "",
      eidExp: formatDateUTC(s.eidExpiry),
      ohcExp: formatDateUTC(s.ohcExpiry),
      bfhcExp: formatDateUTC(s.bfhcExpiry),
      passExp: formatDateUTC(s.passportExpiry),
      gender: s.gender ?? "",
      nationality: titleCaseLabel(s.nationality),
      location: titleCaseLabel(s.location),
      // Derived from the documents, matching the Status column on screen.
      status: effectiveStatus(s, docs).status === "ACTIVE" ? "Active" : "Inactive",
      bankTitle: s.bankAccountTitle ?? "",
      iban: s.iban ?? "",
      bank: s.bankName ?? "",
      docs: docs.summary,
    };
  });

  if (format === "csv") return csvResponse(rows, stamp);
  if (format === "pdf") return pdfResponse(rows, stamp);
  return xlsxResponse(rows, stamp);
}

// ── Excel: navy/gold-branded workbook ──
async function xlsxResponse(rows: Row[], stamp: string): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BME MIS";
  const ws = wb.addWorksheet("Staff", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF184170" } };
    cell.alignment = { vertical: "middle" };
  });

  for (const r of rows) ws.addRow(r);

  const body = await wb.xlsx.writeBuffer();
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bme-staff-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── CSV: UTF-8 with BOM so Excel opens it with the right encoding ──
function csvResponse(rows: Row[], stamp: string): Response {
  const esc = (v: string | number | undefined) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(COLS.map((c) => esc(r[c.key])).join(","));
  const body = "﻿" + lines.join("\r\n"); // BOM → Excel reads UTF-8 correctly
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bme-staff-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── PDF: a print-optimised, branded HTML page that opens the browser's print
// dialog (choose "Save as PDF"). Dependency-free and works in every browser. ──
function pdfResponse(rows: Row[], stamp: string): Response {
  const esc = (v: string | number | undefined) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string
    ));
  const head = COLS.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${COLS.map((c) => `<td>${esc(r[c.key])}</td>`).join("")}</tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BME Staff Report — ${stamp}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f2440; margin: 0; padding: 20px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #184170; padding-bottom: 8px; margin-bottom: 12px; }
  .head h1 { font-size: 16px; margin: 0; color: #184170; }
  .head .meta { font-size: 11px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  thead th { background: #184170; color: #fff; text-align: left; padding: 5px 6px; border: 1px solid #123256; white-space: nowrap; }
  tbody td { padding: 4px 6px; border: 1px solid #dbe2ec; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f5f8fc; }
  .foot { margin-top: 10px; font-size: 10px; color: #94a3b8; text-align: right; }
  @media print { .hint { display: none; } }
  .hint { margin: 0 0 12px; font-size: 12px; color: #64748b; }
</style>
</head>
<body onload="window.print()">
  <p class="hint">Your print dialog should open automatically — choose “Save as PDF”. If it doesn't, press Ctrl/Cmd&nbsp;+&nbsp;P.</p>
  <div class="head">
    <h1>BME · Staff &amp; Document Report</h1>
    <span class="meta">${rows.length} record${rows.length === 1 ? "" : "s"} · ${stamp}</span>
  </div>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">Brilliant Minds Events LLC — Management Information System</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

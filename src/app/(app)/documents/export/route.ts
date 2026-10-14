import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/auth";
import { getSettings } from "@/lib/settings";
import { can } from "@/lib/rbac";
import { buildExpiryReport } from "@/lib/expiry-report";
import { STATUS_LABEL, type ComputedStatus, type DocKey } from "@/lib/doc-status";
import { formatDateUTC } from "@/lib/format";

const STATUS_OF: Record<string, ComputedStatus> = {
  expired: "EXPIRED", expiring: "EXPIRING_SOON", missing: "MISSING",
};

// Export the Document-Expiry renewals worklist (spec §10), honouring the same
// status/type filters as the on-screen report.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!can(session.user.role, "staff:viewAll")) return new Response("Forbidden", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const statusKey = sp.get("status") ?? "";
  const typeKey = sp.get("type") ?? "";
  const wantStatus = STATUS_OF[statusKey] ?? null;
  const wantType = (["eid", "ohc", "bfhc", "passport"] as DocKey[]).includes(typeKey as DocKey)
    ? (typeKey as DocKey)
    : null;

  const now = new Date();
  const { expiryWindowDays } = await getSettings();
  const report = await buildExpiryReport(expiryWindowDays, now);
  const rows = report.problems.filter(
    (p) => (!wantStatus || p.status === wantStatus) && (!wantType || p.docKey === wantType),
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "BME MIS";
  const ws = wb.addWorksheet("Renewals", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Staff No.", key: "id", width: 9 },
    { header: "Full Name", key: "name", width: 30 },
    { header: "Category", key: "category", width: 16 },
    { header: "Location", key: "location", width: 24 },
    { header: "Document", key: "doc", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "Expiry", key: "expiry", width: 14 },
    { header: "Days", key: "days", width: 14 },
  ];

  const header = ws.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF184170" } };
    cell.alignment = { vertical: "middle" };
  });

  for (const p of rows) {
    ws.addRow({
      id: p.staffId,
      name: p.staffName,
      category: p.category ?? "",
      location: p.location ?? "",
      doc: p.label,
      status: STATUS_LABEL[p.status],
      expiry: formatDateUTC(p.expiry),
      days: p.days === null ? "" : p.days < 0 ? `${Math.abs(p.days)} overdue` : p.days === 0 ? "today" : `${p.days} left`,
    });
  }

  const body = await wb.xlsx.writeBuffer();
  const stamp = now.toISOString().slice(0, 10);
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bme-renewals-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

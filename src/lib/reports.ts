import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import { formatTimeUTC, STATUS_LABEL, toHours } from "@/lib/deployment";
import {
  approvedOnly, groupBy, totalsOf, workedBy,
  type DeploymentParams, type DeploymentRow,
} from "@/lib/deployment-query";
import type { ExportCol, ExportDoc, ExportRow } from "@/lib/report-export";

// The four Phase-2 reports, defined once. Each returns columns + rows + totals, and
// both the screen and the Excel/PDF export render exactly that structure — so an
// exported figure can never differ from the one on screen.
//
// Reports B and C are restricted to APPROVED rows. That is the entire point of the
// approval chain: wages and invoices come only from hours a manager signed off.

export type ReportKey = "actual" | "payroll" | "billing" | "variance";

export const REPORTS: { key: ReportKey; title: string; blurb: string; approvedOnly: boolean }[] = [
  { key: "actual", title: "Actual Deployment Report", blurb: "Who was actually deployed, from verified and approved timesheets.", approvedOnly: true },
  { key: "payroll", title: "Staff Working Hours / Payroll", blurb: "Days and hours per staff member, regular and overtime — the basis for wages.", approvedOnly: true },
  { key: "billing", title: "Client Chargeable Hours", blurb: "Chargeable days and hours per client and event — the basis for invoicing.", approvedOnly: true },
  { key: "variance", title: "Scheduled vs Actual", blurb: "Where the day differed from the plan: hours, overtime, absences and replacements.", approvedOnly: false },
];

const rangeLabel = (p: DeploymentParams) => `${p.from} to ${p.to}`;

function scope(p: DeploymentParams, rows: DeploymentRow[], approved: boolean): string {
  const bits = [rangeLabel(p), `${rows.length} row${rows.length === 1 ? "" : "s"}`];
  if (approved) bits.push("approved only");
  if (p.clientId && rows[0]) bits.push(titleCaseLabel(rows[0].project.client.name));
  return bits.join(" · ");
}

// ── A. Actual Deployment Report ─────────────────────────────────────────────
export function actualDeploymentReport(p: DeploymentParams, all: DeploymentRow[]): ExportDoc {
  const rows = approvedOnly(all);
  const cols: ExportCol[] = [
    { key: "timesheetNo", header: "Timesheet No.", width: 13 },
    { key: "date", header: "Event date", width: 13 },
    { key: "client", header: "Client", width: 22 },
    { key: "project", header: "Event", width: 24 },
    { key: "location", header: "Location", width: 20 },
    { key: "staffId", header: "Staff ID", width: 9 },
    { key: "staff", header: "Staff name", width: 30 },
    { key: "category", header: "Category / Position", width: 18 },
    { key: "shift", header: "Shift", width: 12 },
    { key: "duty", header: "Staff Category", width: 18 },
    { key: "scheduled", header: "Scheduled duty time", width: 20 },
    { key: "actual", header: "Actual in – out", width: 20 },
    { key: "hours", header: "Working hours", width: 13, numeric: true },
    { key: "ot", header: "Overtime", width: 11, numeric: true },
    { key: "status", header: "Deployment status", width: 18 },
  ];
  const out: ExportRow[] = rows.map((r) => {
    const w = workedBy(r);
    return {
      timesheetNo: r.timesheetNo ?? "",
      date: formatDateUTC(r.eventDate),
      client: titleCaseLabel(r.project.client.name),
      project: titleCaseLabel(r.project.name),
      location: titleCaseLabel(r.location ?? r.project.location ?? ""),
      staffId: w.id,
      staff: titleCaseName(w.fullName) + (r.replacementStaff ? ` (for ${titleCaseName(r.staff.fullName)})` : ""),
      category: titleCaseLabel(r.category ?? ""),
      shift: titleCaseLabel(r.shift ?? ""),
      duty: r.duty ?? "",
      scheduled: `${formatTimeUTC(r.startAt)} – ${formatTimeUTC(r.endAt)}`,
      actual: r.hours.absent ? "Absent" : r.hours.hasActual ? `${formatTimeUTC(r.actualIn)} – ${formatTimeUTC(r.actualOut)}` : "—",
      hours: toHours(r.hours.actualMinutes),
      ot: toHours(r.hours.overtimeMinutes),
      status: STATUS_LABEL[r.status],
    };
  });
  const t = totalsOf(rows);
  return {
    title: "Actual Deployment Report",
    subtitle: `${scope(p, rows, true)} · ${t.manDays} man-day${t.manDays === 1 ? "" : "s"}`,
    cols, rows: out,
    totals: {
      date: "TOTAL", staff: `${t.shifts} shifts`, category: `${t.manDays} man-days`,
      hours: t.actualHours, ot: t.overtimeHours,
    },
    filename: `bme-actual-deployment-${p.from}_${p.to}`,
  };
}

// ── B. Staff Working Hours / Payroll ────────────────────────────────────────
export function payrollReport(p: DeploymentParams, all: DeploymentRow[]): ExportDoc {
  const rows = approvedOnly(all);
  // Hours belong to whoever actually worked, which is the replacement when one stood in.
  const grouped = groupBy(rows, (r) => String(workedBy(r).id), (r) => workedBy(r));
  const cols: ExportCol[] = [
    { key: "staffId", header: "Staff ID", width: 9 },
    { key: "staff", header: "Staff name", width: 32 },
    { key: "category", header: "Category", width: 18 },
    { key: "days", header: "Days worked", width: 12, numeric: true },
    { key: "shifts", header: "Shifts", width: 9, numeric: true },
    { key: "scheduled", header: "Scheduled hrs", width: 14, numeric: true },
    { key: "regular", header: "Regular hrs", width: 13, numeric: true },
    { key: "ot", header: "Overtime hrs", width: 13, numeric: true },
    { key: "total", header: "Total hrs", width: 12, numeric: true },
    { key: "absences", header: "Absences", width: 11, numeric: true },
  ];
  const out: ExportRow[] = grouped.map((g) => {
    const t = totalsOf(g.rows);
    const days = new Set(g.rows.filter((r) => !r.hours.absent).map((r) => r.eventDate.toISOString().slice(0, 10))).size;
    return {
      staffId: g.meta.id,
      staff: titleCaseName(g.meta.fullName),
      category: titleCaseLabel(g.rows[0]?.category ?? ""),
      days,
      shifts: t.shifts,
      scheduled: t.scheduledHours,
      // Regular = worked minus overtime, so regular + overtime always equals total.
      regular: Math.round((t.actualHours - t.overtimeHours) * 100) / 100,
      ot: t.overtimeHours,
      total: t.actualHours,
      absences: t.absences,
    };
  }).sort((a, b) => String(a.staff).localeCompare(String(b.staff)));

  const t = totalsOf(rows);
  return {
    title: "Staff Working Hours / Payroll Report",
    subtitle: `${scope(p, rows, true)} · ${grouped.length} staff`,
    cols, rows: out,
    totals: {
      staff: "TOTAL", shifts: t.shifts, scheduled: t.scheduledHours,
      regular: Math.round((t.actualHours - t.overtimeHours) * 100) / 100,
      ot: t.overtimeHours, total: t.actualHours, absences: t.absences,
    },
    filename: `bme-payroll-hours-${p.from}_${p.to}`,
  };
}

// ── C. Client Chargeable Hours ──────────────────────────────────────────────
export function billingReport(p: DeploymentParams, all: DeploymentRow[]): ExportDoc {
  const rows = approvedOnly(all);
  const grouped = groupBy(
    rows,
    (r) => `${r.project.client.id}:${r.project.id}`,
    (r) => ({ client: r.project.client.name, project: r.project.name }),
  );
  const cols: ExportCol[] = [
    { key: "client", header: "Client", width: 26 },
    { key: "project", header: "Event", width: 28 },
    { key: "days", header: "Chargeable days", width: 15, numeric: true },
    { key: "shifts", header: "Shifts", width: 9, numeric: true },
    { key: "staff", header: "Staff deployed", width: 14, numeric: true },
    { key: "scheduled", header: "Scheduled hrs", width: 14, numeric: true },
    { key: "regular", header: "Regular hrs", width: 13, numeric: true },
    { key: "ot", header: "Overtime hrs", width: 13, numeric: true },
    { key: "total", header: "Chargeable hrs", width: 15, numeric: true },
  ];
  const out: ExportRow[] = grouped.map((g) => {
    const t = totalsOf(g.rows);
    return {
      client: titleCaseLabel(g.meta.client),
      project: titleCaseLabel(g.meta.project),
      days: new Set(g.rows.map((r) => r.eventDate.toISOString().slice(0, 10))).size,
      shifts: t.shifts,
      staff: new Set(g.rows.map((r) => workedBy(r).id)).size,
      scheduled: t.scheduledHours,
      regular: Math.round((t.actualHours - t.overtimeHours) * 100) / 100,
      ot: t.overtimeHours,
      total: t.actualHours,
    };
  }).sort((a, b) => String(a.client).localeCompare(String(b.client)));

  const t = totalsOf(rows);
  return {
    title: "Client Chargeable Hours Report",
    subtitle: `${scope(p, rows, true)} · ${grouped.length} project${grouped.length === 1 ? "" : "s"}`,
    cols, rows: out,
    totals: { client: "TOTAL", shifts: t.shifts, scheduled: t.scheduledHours, ot: t.overtimeHours, total: t.actualHours },
    filename: `bme-chargeable-hours-${p.from}_${p.to}`,
  };
}

// ── D. Scheduled vs Actual ──────────────────────────────────────────────────
// Not approved-only: the whole purpose is to surface discrepancies before sign-off.
export function varianceReport(p: DeploymentParams, all: DeploymentRow[]): ExportDoc {
  // Cancelled shifts never happened, so they are not part of any comparison.
  const rows = all.filter((r) => r.status !== "CANCELLED");
  const cols: ExportCol[] = [
    { key: "timesheetNo", header: "Timesheet No.", width: 13 },
    { key: "date", header: "Event date", width: 13 },
    { key: "client", header: "Client", width: 20 },
    { key: "project", header: "Event", width: 22 },
    { key: "staffId", header: "Staff ID", width: 9 },
    { key: "duty", header: "Staff Category", width: 18 },
    { key: "scheduledStaff", header: "Scheduled staff", width: 28 },
    { key: "actualStaff", header: "Actual staff", width: 28 },
    { key: "schedHrs", header: "Scheduled hrs", width: 14, numeric: true },
    { key: "actualHrs", header: "Actual hrs", width: 12, numeric: true },
    { key: "diff", header: "Difference", width: 12, numeric: true },
    { key: "ot", header: "Overtime", width: 11, numeric: true },
    { key: "late", header: "Late (min)", width: 11, numeric: true },
    { key: "early", header: "Early out (min)", width: 14, numeric: true },
    { key: "issue", header: "Discrepancy", width: 26 },
    { key: "status", header: "Status", width: 18 },
  ];
  const out: ExportRow[] = rows.map((r) => {
    const issues: string[] = [];
    if (r.hours.absent) issues.push("No-show");
    if (r.replacementStaff) issues.push(r.noShow ? "No-show, covered" : "Replaced");
    if (r.hours.lateMinutes > 0) issues.push("Late");
    if (r.hours.earlyDepartureMinutes > 0) issues.push("Early departure");
    if (r.hours.overtimeMinutes > 0) issues.push("Overtime");
    if (!r.hours.hasActual && !r.hours.absent) issues.push("No timesheet");
    return {
      timesheetNo: r.timesheetNo ?? "",
      date: formatDateUTC(r.eventDate),
      client: titleCaseLabel(r.project.client.name),
      project: titleCaseLabel(r.project.name),
      staffId: r.staff.id,
      duty: r.duty ?? titleCaseLabel(r.category ?? ""),
      scheduledStaff: titleCaseName(r.staff.fullName),
      actualStaff: r.hours.absent ? "— absent —" : titleCaseName(workedBy(r).fullName),
      schedHrs: toHours(r.hours.scheduledMinutes),
      actualHrs: toHours(r.hours.actualMinutes),
      diff: toHours(r.hours.varianceMinutes),
      ot: toHours(r.hours.overtimeMinutes),
      late: r.hours.lateMinutes,
      early: r.hours.earlyDepartureMinutes,
      issue: issues.join(", ") || "As scheduled",
      status: STATUS_LABEL[r.status],
    };
  });
  const t = totalsOf(rows);
  return {
    title: "Scheduled vs Actual Report",
    subtitle: `${scope(p, rows, false)} · ${t.manDays} man-day${t.manDays === 1 ? "" : "s"} · ${t.absences} absence(s), ${t.replacements} replacement(s)`,
    cols, rows: out,
    totals: {
      date: "TOTAL", duty: `${t.manDays} man-days`, schedHrs: t.scheduledHours, actualHrs: t.actualHours,
      diff: t.varianceHours, ot: t.overtimeHours,
      issue: `${t.absences} absent · ${t.replacements} replaced · ${t.lateCount} late`,
    },
    filename: `bme-scheduled-vs-actual-${p.from}_${p.to}`,
  };
}

export function buildReport(key: ReportKey, p: DeploymentParams, rows: DeploymentRow[]): ExportDoc {
  switch (key) {
    case "payroll": return payrollReport(p, rows);
    case "billing": return billingReport(p, rows);
    case "variance": return varianceReport(p, rows);
    default: return actualDeploymentReport(p, rows);
  }
}

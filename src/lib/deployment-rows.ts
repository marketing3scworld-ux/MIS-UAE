import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import { formatTimeUTC } from "@/lib/deployment";
import type { DeploymentRow } from "@/lib/deployment-query";
import type { DeploymentTableRow } from "@/app/(app)/deployments/_components/deployment-table";

// Single place that turns a database row into the shape shown on screen AND written
// to Excel/PDF, so a report and its export can never disagree.

export function flagsFor(r: DeploymentRow): string[] {
  const f: string[] = [];
  if (r.hours.absent) f.push("Absent");
  if (r.replacementStaffId) f.push("Replaced");
  if (r.hours.lateMinutes > 0) f.push("Late");
  if (r.hours.earlyDepartureMinutes > 0) f.push("Early out");
  return f;
}

export function toTableRow(r: DeploymentRow): DeploymentTableRow {
  return {
    id: r.id,
    date: formatDateUTC(r.eventDate),
    client: titleCaseLabel(r.project.client.name),
    project: titleCaseLabel(r.project.name),
    location: titleCaseLabel(r.location ?? r.project.location ?? ""),
    staffId: r.staff.id,
    staffName: titleCaseName(r.staff.fullName),
    category: titleCaseLabel(r.category ?? r.staff.category ?? ""),
    shift: titleCaseLabel(r.shift ?? ""),
    duty: r.duty ?? "",
    scheduled: `${formatTimeUTC(r.startAt)} – ${formatTimeUTC(r.endAt)}`,
    scheduledMinutes: r.hours.scheduledMinutes,
    actual: r.hours.absent
      ? "Absent"
      : r.hours.hasActual
        ? `${formatTimeUTC(r.actualIn)} – ${formatTimeUTC(r.actualOut)}`
        : "—",
    actualMinutes: r.hours.actualMinutes,
    overtimeMinutes: r.hours.overtimeMinutes,
    varianceMinutes: r.hours.hasActual || r.hours.absent ? r.hours.varianceMinutes : 0,
    status: r.status,
    flags: flagsFor(r),
    replacedBy: r.replacementStaff ? titleCaseName(r.replacementStaff.fullName) : null,
  };
}

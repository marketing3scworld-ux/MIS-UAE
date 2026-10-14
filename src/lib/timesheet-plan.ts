import type { Prisma, DeploymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildShiftRange, canEditApproved, formatHM, formatTimeUTC, isAtOrAfter, type Actor } from "@/lib/deployment";
import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import { TS_HEADERS, type SheetRow } from "@/lib/timesheet-sheet";

// What an uploaded timesheet would do, worked out before anything is written. Kept
// out of the server action so the decision for each row can be exercised on its own —
// these figures become wages, so "we think it matched the right shift" is not good
// enough without being able to check it.
//
// Every row lands through the same rules as the single-shift form in
// deployments/[id]/timesheet-form.tsx: entering actuals moves the shift to Timesheet
// submitted, and touching an approved row reopens it. Nothing here ever writes an
// APPROVED status — an upload is a faster way to type, not a way past the approval
// chain.

export const PLAN_SELECT = {
  id: true, status: true, eventDate: true, staffId: true, submittedAt: true,
  actualIn: true, actualOut: true, actualBreakMinutes: true, noShow: true, notes: true,
  staff: { select: { fullName: true } },
  replacementStaff: { select: { fullName: true } },
  project: { select: { name: true, client: { select: { name: true } } } },
} satisfies Prisma.DeploymentSelect;

export type PlanDeployment = Prisma.DeploymentGetPayload<{ select: typeof PLAN_SELECT }>;

export type PlanRow = {
  sheetRow: number;
  source?: string; // file and line the row came from, when it did not come from the template
  deploymentId: number | null;
  label: string;
  action: "update" | "create" | "unchanged" | "error";
  detail: string;
  minutes?: number; // worked minutes this row would record
};

export type Target = {
  id: number;
  label: string;
  timesheetNo?: number | null; // stamped from the sheet's own number, when it had one
  after: {
    actualIn: Date | null;
    actualOut: Date | null;
    actualBreakMinutes: number | null;
    noShow: boolean;
    notes: string | null;
  };
  wasApproved: boolean;
  currentStatus: DeploymentStatus;
  submittedAt: Date | null;
};

const hhmm = (d: Date | null | undefined) => (d ? formatTimeUTC(d) : "");

type Actuals = {
  actualIn: Date | null;
  actualOut: Date | null;
  actualBreakMinutes: number | null;
  noShow: boolean;
};

/** Minutes worked, the same arithmetic as computeHours in lib/deployment.ts. */
export function workedMinutes(a: Actuals): number {
  if (a.noShow || !a.actualIn || !a.actualOut) return 0;
  return Math.max(0, Math.round((a.actualOut.getTime() - a.actualIn.getTime()) / 60_000) - (a.actualBreakMinutes ?? 0));
}

/** How a shift's actuals read today, or would read after the upload. */
export function describeActuals(a: Actuals): string {
  if (a.noShow) return "No-show";
  if (!a.actualIn || !a.actualOut) return "—";
  const brk = a.actualBreakMinutes ? ` (${a.actualBreakMinutes}m break)` : "";
  return `${hhmm(a.actualIn)} – ${hhmm(a.actualOut)}${brk} = ${formatHM(workedMinutes(a))}`;
}

export function planTimesheetRows(
  sheetRows: SheetRow[],
  deployments: PlanDeployment[],
  a: Actor,
): { plan: PlanRow[]; targets: Target[] } {
  const byId = new Map(deployments.map((d) => [d.id, d]));
  const plan: PlanRow[] = [];
  const targets: Target[] = [];
  const seen = new Set<number>();

  for (const s of sheetRows) {
    const push = (action: PlanRow["action"], detail: string, label = s.source ?? `Row ${s.row}`) =>
      plan.push({
        sheetRow: s.row, source: s.source, deploymentId: s.deploymentId, label, action,
        detail: s.matchNote && action !== "error" ? `${detail}  (${s.matchNote})` : detail,
      });

    if (!s.deploymentId) {
      push("error", `No ${TS_HEADERS.id} on this row — it cannot be matched to a shift.`);
      continue;
    }
    const d = byId.get(s.deploymentId);
    if (!d) {
      push("error", `${TS_HEADERS.id} ${s.deploymentId} is not a deployment in this system.`);
      continue;
    }

    const who = d.replacementStaff?.fullName ?? d.staff.fullName;
    const label = `${formatDateUTC(d.eventDate)} · ${titleCaseLabel(d.project.client.name)} · ${titleCaseName(who)}`;

    if (seen.has(d.id)) { push("error", "This shift already appears earlier in this upload — it is only recorded once.", label); continue; }
    seen.add(d.id);

    if (d.status === "CANCELLED") { push("error", "This shift was cancelled.", label); continue; }
    if (d.status === "APPROVED" && !canEditApproved(a)) {
      push("error", "Already approved — only HR/Admin can change approved hours.", label);
      continue;
    }
    if (s.blank) { push("unchanged", "Nothing filled in on this row.", label); continue; }

    // Absent and worked are mutually exclusive, exactly as the single-shift form has it.
    if (s.noShow && (s.actualIn || s.actualOut)) {
      push("error", "Marked no-show but also has times — clear one or the other.", label);
      continue;
    }
    if (!s.noShow && !!s.actualIn !== !!s.actualOut) {
      push("error", `Needs both ${TS_HEADERS.actualIn} and ${TS_HEADERS.actualOut}.`, label);
      continue;
    }
    if (s.breakMinutes !== null && (s.breakMinutes < 0 || s.breakMinutes > 600)) {
      push("error", `${TS_HEADERS.break} must be between 0 and 600.`, label);
      continue;
    }
    if (!s.noShow && !s.actualIn && s.notes === null && s.breakMinutes === null) {
      push("unchanged", "No times given.", label);
      continue;
    }

    const dayISO = d.eventDate.toISOString().slice(0, 10);
    let actualIn: Date | null = null;
    let actualOut: Date | null = null;
    if (!s.noShow && s.actualIn && s.actualOut) {
      // An out earlier than the in means the shift ran past midnight.
      const r = buildShiftRange(dayISO, s.actualIn, s.actualOut);
      actualIn = r.startAt;
      actualOut = r.endAt;
    }

    const after = {
      actualIn,
      actualOut,
      actualBreakMinutes: s.noShow ? null : (s.breakMinutes ?? d.actualBreakMinutes ?? 0),
      noShow: s.noShow,
      notes: s.notes ?? d.notes ?? null,
    };

    const same =
      after.actualIn?.getTime() === d.actualIn?.getTime() &&
      after.actualOut?.getTime() === d.actualOut?.getTime() &&
      after.actualBreakMinutes === d.actualBreakMinutes &&
      after.noShow === d.noShow &&
      after.notes === d.notes;
    if (same) { push("unchanged", `Already recorded as ${describeActuals(d)}.`, label); continue; }

    // The notes change is spelled out: describeActuals leaves notes off, and an update
    // that only rewrites a note would otherwise read "14:00 – 00:00 → 14:00 – 00:00".
    const noteChange = after.notes !== d.notes ? `  · note: "${after.notes ?? ""}"` : "";
    push("update", `${describeActuals(d)}  →  ${describeActuals(after)}${noteChange}`, label);
    plan[plan.length - 1].minutes = workedMinutes(after);
    targets.push({
      id: d.id,
      label,
      timesheetNo: s.timesheetNo ?? null,
      after,
      wasApproved: d.status === "APPROVED",
      currentStatus: d.status,
      submittedAt: d.submittedAt,
    });
  }

  return { plan, targets };
}

/**
 * Write the planned rows. Each shift gets its own transaction: one row that fails
 * must not roll back the rest of the venue's day.
 */
export async function applyTimesheetTargets(
  targets: Target[],
  userId: number,
): Promise<{ written: number; failed: string[] }> {
  let written = 0;
  const failed: string[] = [];

  for (const t of targets) {
    const status: DeploymentStatus = t.wasApproved
      ? "TIMESHEET_SUBMITTED"
      : isAtOrAfter(t.currentStatus, "TIMESHEET_SUBMITTED")
        ? t.currentStatus
        : (t.after.actualIn || t.after.noShow) ? "TIMESHEET_SUBMITTED" : t.currentStatus;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.deployment.update({
          where: { id: t.id },
          data: {
            ...(t.after as Prisma.DeploymentUncheckedUpdateInput),
            ...(t.timesheetNo ? { timesheetNo: t.timesheetNo } : {}),
            status,
            updatedById: userId,
            submittedAt: status === "TIMESHEET_SUBMITTED" ? new Date() : t.submittedAt,
            ...(t.wasApproved
              ? { approvedById: null, approvedAt: null, verifiedById: null, verifiedAt: null }
              : {}),
          },
        });
        await tx.deploymentAudit.create({
          data: {
            deploymentId: t.id,
            userId,
            action: t.wasApproved ? "edited-after-approval" : "timesheet-upload",
            field: "actuals",
            newValue: describeActuals(t.after),
          },
        });
        if (t.wasApproved) {
          await tx.deploymentAudit.create({ data: { deploymentId: t.id, userId, action: "reopened" } });
        }
      });
      written++;
    } catch {
      failed.push(t.label);
    }
  }

  return { written, failed };
}

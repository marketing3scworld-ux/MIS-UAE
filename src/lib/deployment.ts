import type { Deployment, DeploymentStatus, Role } from "@prisma/client";

// Phase 2 domain rules: the workflow state machine, and the hours arithmetic that
// payroll and client invoicing are both derived from. Everything numeric lives
// here so a report, a screen and an export can never disagree about what "hours
// worked" means.

// ── Workflow ────────────────────────────────────────────────────────────────
// Scheduled → Deployed → Timesheet Submitted → Timesheet Verified → Approved
// Cancelled is reachable from anything before Approved and is excluded from every
// report and from the double-booking check.
export const DEPLOYMENT_FLOW: DeploymentStatus[] = [
  "SCHEDULED", "DEPLOYED", "TIMESHEET_SUBMITTED", "TIMESHEET_VERIFIED", "APPROVED",
];

export const STATUS_LABEL: Record<DeploymentStatus, string> = {
  SCHEDULED: "Scheduled",
  DEPLOYED: "Deployed",
  TIMESHEET_SUBMITTED: "Timesheet submitted",
  TIMESHEET_VERIFIED: "Timesheet verified",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

// Tailwind text colours, reusing the traffic-light tokens from spec §6.
export const STATUS_TONE: Record<DeploymentStatus, string> = {
  SCHEDULED: "text-slate-500",
  DEPLOYED: "text-[#2f6bd8]",
  TIMESHEET_SUBMITTED: "text-status-expiring",
  TIMESHEET_VERIFIED: "text-[#7c3aed]",
  APPROVED: "text-status-valid",
  CANCELLED: "text-status-expired",
};

/** Which status a given transition may move to. */
export function nextStatus(current: DeploymentStatus): DeploymentStatus | null {
  const i = DEPLOYMENT_FLOW.indexOf(current);
  if (i === -1 || i === DEPLOYMENT_FLOW.length - 1) return null;
  return DEPLOYMENT_FLOW[i + 1];
}

export function isAtOrAfter(status: DeploymentStatus, mark: DeploymentStatus): boolean {
  if (status === "CANCELLED") return false;
  return DEPLOYMENT_FLOW.indexOf(status) >= DEPLOYMENT_FLOW.indexOf(mark);
}

// ── Who may do what ─────────────────────────────────────────────────────────
// The spec names four duties. They map onto the existing five roles plus the
// per-user Operations-Head flag rather than inventing new roles:
//
//   Operations  -> OPERATIONS            create deployments, enter actuals
//   Supervisor  -> isOperationsHead      verify timesheets
//   Ops Manager -> HR_ADMIN / SYS_ADMIN  approve (releases to payroll + billing)
//   Accounts    -> FINANCE               read approved payroll & chargeable hours
//   Management  -> any role              read the reports
export type Actor = { role: Role; isOperationsHead: boolean };

export const canSchedule = (a: Actor) =>
  a.role === "OPERATIONS" || a.role === "HR_ADMIN" || a.role === "SYSTEM_ADMIN";

export const canEnterTimesheet = (a: Actor) => canSchedule(a);

export const canVerify = (a: Actor) =>
  a.isOperationsHead || a.role === "HR_ADMIN" || a.role === "SYSTEM_ADMIN";

// Approval is the gate to money, so it is deliberately narrower than verification.
export const canApprove = (a: Actor) =>
  a.role === "HR_ADMIN" || a.role === "SYSTEM_ADMIN" || (a.isOperationsHead && a.role === "OPERATIONS");

/** Editing something already approved — allowed, but always audited and it reopens. */
export const canEditApproved = (a: Actor) => a.role === "HR_ADMIN" || a.role === "SYSTEM_ADMIN";

export const canSeePay = (a: Actor) =>
  a.role === "FINANCE" || a.role === "HR_ADMIN" || a.role === "SYSTEM_ADMIN";

// ── Hours ───────────────────────────────────────────────────────────────────
// Everything is computed in whole minutes and only converted to hours for display,
// so rounding never compounds across a payroll run.

const MIN = 60_000;
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MIN);

export type Hours = {
  scheduledMinutes: number;
  actualMinutes: number;
  /** Actual beyond scheduled. See the note on the overtime rule below. */
  overtimeMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  varianceMinutes: number; // actual - scheduled; negative = short
  hasActual: boolean;
  absent: boolean;
};

type HoursInput = Pick<
  Deployment,
  "startAt" | "endAt" | "breakMinutes" | "actualIn" | "actualOut" | "actualBreakMinutes" | "noShow" | "status"
> & { replacementStaffId?: number | null };

/**
 * OVERTIME RULE: minutes worked beyond the minutes scheduled for that shift.
 *
 * The Phase-2 brief asks for "overtime hours" without defining the threshold, and
 * UAE practice varies (beyond the rostered shift, or beyond 8h/day, or beyond 48h/
 * week). Per-shift-versus-scheduled is the only one computable from a single
 * deployment row and is the most common for event staffing. Confirm with HR before
 * the first payroll run — changing it means changing this function alone.
 */
export function computeHours(d: HoursInput): Hours {
  const scheduledMinutes = Math.max(0, minutesBetween(d.startAt, d.endAt) - (d.breakMinutes ?? 0));

  // "No-show" describes the person who was SCHEDULED. If someone covered the shift,
  // the work still happened and the hours belong to the replacement — zeroing the
  // row here would leave whoever actually turned up unpaid.
  const covered = !!d.replacementStaffId;
  const absent = d.noShow && !covered;
  const hasActual = !absent && !!d.actualIn && !!d.actualOut;

  if (!hasActual) {
    return {
      scheduledMinutes,
      actualMinutes: 0,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      varianceMinutes: absent ? -scheduledMinutes : 0,
      hasActual: false,
      absent,
    };
  }

  const inAt = d.actualIn!;
  const outAt = d.actualOut!;
  const actualMinutes = Math.max(0, minutesBetween(inAt, outAt) - (d.actualBreakMinutes ?? 0));

  return {
    scheduledMinutes,
    actualMinutes,
    overtimeMinutes: Math.max(0, actualMinutes - scheduledMinutes),
    lateMinutes: Math.max(0, minutesBetween(d.startAt, inAt)),
    earlyDepartureMinutes: Math.max(0, minutesBetween(outAt, d.endAt)),
    varianceMinutes: actualMinutes - scheduledMinutes,
    hasActual: true,
    absent: false,
  };
}

/** 495 -> "8.25". Two decimals is what payroll spreadsheets expect. */
export const toHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;
/** 495 -> "8h 15m", for reading on screen. */
export function formatHM(minutes: number): string {
  if (!minutes) return "—";
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(minutes);
  return `${sign}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "HH:MM" in UTC — shift times are stored as absolute instants. */
export function formatTimeUTC(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Combine an operational date with a "HH:MM" wall-clock time. When the end time is
 * at or before the start, the shift crosses midnight and the end belongs to the
 * next calendar day — without this a night shift computes as negative hours.
 */
export function shiftInstant(dateISO: string, hhmm: string, rollOver = false): Date {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0) + (rollOver ? 86_400_000 : 0));
}

export function buildShiftRange(dateISO: string, startHHMM: string, endHHMM: string): { startAt: Date; endAt: Date } {
  const startAt = shiftInstant(dateISO, startHHMM);
  let endAt = shiftInstant(dateISO, endHHMM);
  if (endAt <= startAt) endAt = shiftInstant(dateISO, endHHMM, true); // crosses midnight
  return { startAt, endAt };
}

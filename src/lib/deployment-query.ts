import type { Prisma, DeploymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeHours, toHours, type Hours } from "@/lib/deployment";

// Shared filter parsing + aggregation for every Phase-2 screen and export, so the
// on-screen report and the Excel/PDF of it can never diverge. The brief asks for
// the same filter set everywhere: date range, client, project/event, location,
// staff member, staff category.

export type DeploymentParams = {
  from: string; // yyyy-mm-dd
  to: string;
  clientId: number | null;
  projectId: number | null;
  location: string;
  staffId: number | null;
  category: string;
  status: string; // "" = all
  q: string;
};

type Raw = Record<string, string | string[] | undefined>;

/** Defaults to the current calendar month when no range is supplied. */
export function parseDeploymentParams(sp: Raw, now = new Date()): DeploymentParams {
  const g = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const num = (k: string) => {
    const n = Number.parseInt(g(k), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: g("from") || iso(monthStart),
    to: g("to") || iso(monthEnd),
    clientId: num("clientId"),
    projectId: num("projectId"),
    location: g("location"),
    staffId: num("staffId"),
    category: g("category"),
    status: g("status"),
    q: g("q"),
  };
}

const dayUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};

export function buildDeploymentWhere(p: DeploymentParams): Prisma.DeploymentWhereInput {
  const AND: Prisma.DeploymentWhereInput[] = [
    { eventDate: { gte: dayUTC(p.from), lte: dayUTC(p.to) } },
  ];
  if (p.clientId) AND.push({ project: { clientId: p.clientId } });
  if (p.projectId) AND.push({ projectId: p.projectId });
  if (p.location) AND.push({ location: { contains: p.location, mode: "insensitive" } });
  if (p.staffId) AND.push({ OR: [{ staffId: p.staffId }, { replacementStaffId: p.staffId }] });
  if (p.category) AND.push({ category: { contains: p.category, mode: "insensitive" } });
  if (p.status && p.status !== "ALL") AND.push({ status: p.status as DeploymentStatus });
  if (p.q) {
    AND.push({
      OR: [
        { staff: { fullName: { contains: p.q, mode: "insensitive" } } },
        { project: { name: { contains: p.q, mode: "insensitive" } } },
        { project: { client: { name: { contains: p.q, mode: "insensitive" } } } },
        { duty: { contains: p.q, mode: "insensitive" } },
        { location: { contains: p.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND };
}

export function deploymentQueryString(p: Partial<DeploymentParams>): string {
  const u = new URLSearchParams();
  if (p.from) u.set("from", p.from);
  if (p.to) u.set("to", p.to);
  if (p.clientId) u.set("clientId", String(p.clientId));
  if (p.projectId) u.set("projectId", String(p.projectId));
  if (p.location) u.set("location", p.location);
  if (p.staffId) u.set("staffId", String(p.staffId));
  if (p.category) u.set("category", p.category);
  if (p.status) u.set("status", p.status);
  if (p.q) u.set("q", p.q);
  return u.toString();
}

const ROW_SELECT = {
  id: true, eventDate: true, timesheetNo: true, location: true, shift: true, duty: true, category: true,
  startAt: true, endAt: true, breakMinutes: true, status: true,
  actualIn: true, actualOut: true, actualBreakMinutes: true, noShow: true, notes: true,
  staffId: true, replacementStaffId: true,
  staff: { select: { id: true, fullName: true, category: true } },
  replacementStaff: { select: { id: true, fullName: true } },
  project: { select: { id: true, name: true, location: true, client: { select: { id: true, name: true } } } },
  verifiedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  verifiedAt: true, approvedAt: true, submittedAt: true,
} satisfies Prisma.DeploymentSelect;

export type DeploymentRow = Prisma.DeploymentGetPayload<{ select: typeof ROW_SELECT }> & { hours: Hours };

export async function loadDeployments(p: DeploymentParams): Promise<DeploymentRow[]> {
  const rows = await prisma.deployment.findMany({
    where: buildDeploymentWhere(p),
    select: ROW_SELECT,
    orderBy: [{ eventDate: "asc" }, { startAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ ...r, hours: computeHours(r) }));
}

/** The person whose hours these are: the replacement when one covered the shift. */
export const workedBy = (r: DeploymentRow) =>
  r.replacementStaff ? { id: r.replacementStaff.id, fullName: r.replacementStaff.fullName } : r.staff;

// ── Aggregations behind reports B, C and D ──────────────────────────────────

export type Totals = {
  shifts: number;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  varianceHours: number;
  absences: number;
  replacements: number;
  lateCount: number;
  earlyCount: number;
  /** One person working one day. The unit clients and operations plan in. */
  manDays: number;
};

/**
 * Cancelled shifts are excluded from every figure: they did not happen, so counting
 * them would overstate hours, head-count and man-days alike.
 */
export function totalsOf(all: DeploymentRow[]): Totals {
  const rows = all.filter((r) => r.status !== "CANCELLED");
  const t: Totals = {
    shifts: rows.length, scheduledHours: 0, actualHours: 0, overtimeHours: 0,
    varianceHours: 0, absences: 0, replacements: 0, lateCount: 0, earlyCount: 0, manDays: 0,
  };
  let sched = 0, act = 0, ot = 0, varr = 0;
  // A man-day is one person on one date, however many shifts they worked that day;
  // a no-show is nobody's day of work, so it does not count.
  const days = new Set<string>();
  for (const r of rows) {
    if (!r.hours.absent) days.add(`${workedBy(r).id}|${r.eventDate.toISOString().slice(0, 10)}`);
    sched += r.hours.scheduledMinutes;
    act += r.hours.actualMinutes;
    ot += r.hours.overtimeMinutes;
    varr += r.hours.varianceMinutes;
    if (r.hours.absent) t.absences++;
    if (r.replacementStaffId) t.replacements++;
    if (r.hours.lateMinutes > 0) t.lateCount++;
    if (r.hours.earlyDepartureMinutes > 0) t.earlyCount++;
  }
  t.scheduledHours = toHours(sched);
  t.actualHours = toHours(act);
  t.overtimeHours = toHours(ot);
  t.varianceHours = toHours(varr);
  t.manDays = days.size;
  return t;
}

/** Group rows by an arbitrary key, keeping insertion order for stable reports. */
export function groupBy<T>(rows: DeploymentRow[], key: (r: DeploymentRow) => string, meta: (r: DeploymentRow) => T) {
  const out = new Map<string, { key: string; meta: T; rows: DeploymentRow[] }>();
  for (const r of rows) {
    const k = key(r);
    if (!out.has(k)) out.set(k, { key: k, meta: meta(r), rows: [] });
    out.get(k)!.rows.push(r);
  }
  return [...out.values()];
}

/**
 * Only APPROVED rows may drive payroll or an invoice. That is the whole point of
 * the workflow, so it is enforced here rather than left to each report to remember.
 */
export const approvedOnly = (rows: DeploymentRow[]) => rows.filter((r) => r.status === "APPROVED");

/** Filter option lists for the report toolbars. */
export async function filterOptions() {
  const [clients, projects, cats, locs] = await Promise.all([
    prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
    prisma.categoryOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);
  return { clients, projects, categories: cats.map((c) => c.value), locations: locs.map((l) => l.value) };
}

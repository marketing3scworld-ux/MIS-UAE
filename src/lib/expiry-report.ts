// Shared expiry aggregation (spec §10). Loads every ACTIVE staff member with
// current-file presence and computes per-document status, powering both the
// dashboard KPIs/breakdown and the Document-Expiry report.
import { prisma } from "@/lib/prisma";
import {
  statusFromDate, DOC_LABELS, type ComputedStatus, type DocKey,
} from "@/lib/doc-status";

const DOC_KEYS: DocKey[] = ["eid", "ohc", "bfhc", "passport"];
const STATUSES: ComputedStatus[] = ["VALID", "EXPIRING_SOON", "EXPIRED", "MISSING"];

const FIELD: Record<DocKey, "eidExpiry" | "ohcExpiry" | "bfhcExpiry" | "passportExpiry"> = {
  eid: "eidExpiry", ohc: "ohcExpiry", bfhc: "bfhcExpiry", passport: "passportExpiry",
};

export type DocProblem = {
  staffId: number;
  staffName: string;
  category: string | null;
  location: string | null;
  docKey: DocKey;
  label: string;
  status: ComputedStatus; // never VALID
  expiry: Date | null;
  days: number | null; // <0 overdue, >=0 until expiry, null when missing/no date
};

export type ExpiryMatrix = Record<DocKey, Record<ComputedStatus, number>>;

export type ExpiryReport = {
  activeCount: number;
  totals: Record<ComputedStatus, number>; // documents summed across all 4 types
  matrix: ExpiryMatrix; // per document type
  staffWorst: Record<ComputedStatus, number>; // staff counted by their worst doc
  problems: DocProblem[]; // every non-VALID document
};

function daysUntil(expiry: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const exp = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.round((exp - today) / 86_400_000);
}

const SEVERITY: Record<ComputedStatus, number> = { VALID: 0, EXPIRING_SOON: 1, MISSING: 2, EXPIRED: 3 };

export async function buildExpiryReport(windowDays: number, now: Date = new Date()): Promise<ExpiryReport> {
  const staff = await prisma.staff.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: {
      id: true, fullName: true, category: true, location: true,
      eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true,
    },
    orderBy: { fullName: "asc" },
  });
  const ids = staff.map((s) => s.id);

  const docRows = ids.length
    ? await prisma.staffDocument.findMany({
        where: { staffId: { in: ids }, isCurrent: true },
        select: { staffId: true, type: true },
      })
    : [];
  const presence = new Map<number, Set<string>>();
  for (const d of docRows) {
    (presence.get(d.staffId) ?? presence.set(d.staffId, new Set()).get(d.staffId)!).add(d.type);
  }
  const hasFile = (id: number, key: DocKey): boolean => {
    const set = presence.get(id);
    if (!set) return false;
    if (key === "eid") return set.has("EID_FRONT") || set.has("EID_BACK");
    if (key === "ohc") return set.has("OHC");
    if (key === "bfhc") return set.has("BFHC");
    return set.has("PASSPORT");
  };

  const zero = () => Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ComputedStatus, number>;
  const matrix = Object.fromEntries(DOC_KEYS.map((k) => [k, zero()])) as ExpiryMatrix;
  const totals = zero();
  const staffWorst = zero();
  const problems: DocProblem[] = [];

  for (const s of staff) {
    let worst: ComputedStatus = "VALID";
    for (const key of DOC_KEYS) {
      const expiry = s[FIELD[key]] as Date | null;
      const status = statusFromDate(expiry, windowDays, hasFile(s.id, key), now);
      matrix[key][status]++;
      totals[status]++;
      if (SEVERITY[status] > SEVERITY[worst]) worst = status;
      if (status !== "VALID") {
        problems.push({
          staffId: s.id, staffName: s.fullName, category: s.category, location: s.location,
          docKey: key, label: DOC_LABELS[key], status, expiry,
          days: expiry ? daysUntil(expiry, now) : null,
        });
      }
    }
    staffWorst[worst]++;
  }

  // Actionable order: expired (most overdue first), then expiring (soonest), then missing.
  problems.sort((a, b) => {
    if (SEVERITY[b.status] !== SEVERITY[a.status]) return SEVERITY[b.status] - SEVERITY[a.status];
    const ad = a.days ?? Number.POSITIVE_INFINITY;
    const bd = b.days ?? Number.POSITIVE_INFINITY;
    return ad - bd;
  });

  return { activeCount: staff.length, totals, matrix, staffWorst, problems };
}

export { DOC_KEYS, STATUSES };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type MonthlyPoint = { label: string; value: number };

/** Documents (EID/OHC/BFHC/Passport) expiring per month over the next N months. */
export async function upcomingRenewals(now: Date = new Date(), months = 6): Promise<MonthlyPoint[]> {
  const staff = await prisma.staff.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: { eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true },
  });
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), label: MONTH_SHORT[d.getUTCMonth()], value: 0 };
  });
  const put = (date: Date | null) => {
    if (!date) return;
    const b = buckets.find((x) => x.y === date.getUTCFullYear() && x.m === date.getUTCMonth());
    if (b) b.value++;
  };
  for (const s of staff) {
    put(s.eidExpiry); put(s.ohcExpiry); put(s.bfhcExpiry); put(s.passportExpiry);
  }
  return buckets.map((b) => ({ label: b.label, value: b.value }));
}

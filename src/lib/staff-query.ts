import type { Prisma } from "@prisma/client";
import type { ComputedStatus } from "@/lib/doc-status";

// Shared parsing + Prisma where/orderBy builders so the Staff list page and the
// Excel export apply IDENTICAL filtering.
export type StaffParams = {
  q: string;
  status: string;
  approval: string; // "" | PENDING | APPROVED
  category: string;
  location: string;
  flag: string; // "" | expired | expiring | missing | noexpired | noeid | blacklisted
  sort: string;
  dir: "asc" | "desc";
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

export function parseStaffParams(sp: RawParams): StaffParams {
  const g = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  return {
    q: g("q").trim(),
    status: g("status"),
    approval: g("approval"),
    category: g("category"),
    location: g("location"),
    flag: g("flag"),
    sort: g("sort") || "id",
    dir: g("dir") === "desc" ? "desc" : "asc",
    page: Math.max(1, Number.parseInt(g("page") || "1", 10) || 1),
  };
}

// The four tracked documents: expiry column + the file types that satisfy the slot.
// These filters MUST agree with computeDocStatuses() in doc-status.ts, which is what
// the Documents column on screen actually shows. That means weighing whether a file
// was ever uploaded, not just whether a date exists:
//
//   expiry in the past                  -> Expired   (file irrelevant)
//   no expiry date at all               -> Missing
//   expiry ahead but NO file uploaded   -> Missing
//   expiry within the window + file     -> Expiring
//   expiry beyond the window + file     -> Valid
const DOC_SLOTS = [
  { col: "eidExpiry", types: ["EID_FRONT", "EID_BACK"] },
  { col: "ohcExpiry", types: ["OHC"] },
  { col: "bfhcExpiry", types: ["BFHC"] },
  { col: "passportExpiry", types: ["PASSPORT"] },
] as const;

type Slot = (typeof DOC_SLOTS)[number];

const hasFile = (s: Slot): Prisma.StaffWhereInput => ({
  documents: { some: { isCurrent: true, type: { in: [...s.types] } } },
});
const noFile = (s: Slot): Prisma.StaffWhereInput => ({
  documents: { none: { isCurrent: true, type: { in: [...s.types] } } },
});
const dateIs = (s: Slot, cond: Prisma.DateTimeNullableFilter | null): Prisma.StaffWhereInput =>
  ({ [s.col]: cond }) as Prisma.StaffWhereInput;

const isExpired = (s: Slot, today: Date): Prisma.StaffWhereInput =>
  dateIs(s, { lt: today });

const isMissing = (s: Slot, today: Date): Prisma.StaffWhereInput => ({
  OR: [dateIs(s, null), { AND: [dateIs(s, { gte: today }), noFile(s)] }],
});

const isExpiring = (s: Slot, today: Date, windowEnd: Date): Prisma.StaffWhereInput => ({
  AND: [dateIs(s, { gte: today, lte: windowEnd }), hasFile(s)],
});

// A slot is COMPLETE when the document is on file and has not lapsed: a date that
// is set and still in the future, plus an uploaded file. That is exactly VALID or
// EXPIRING_SOON — never EXPIRED, never MISSING.
//
// Note this must be written positively rather than as NOT(expired). `NOT (col <
// today)` evaluates to NULL in SQL when col IS NULL, and a NULL predicate drops the
// row, so the negated form both hid blank-date profiles and let missing files through.
const isComplete = (s: Slot, today: Date): Prisma.StaffWhereInput => ({
  AND: [dateIs(s, { gte: today }), hasFile(s)],
});

// A slot is NOT expired when it has no date at all, or a date still in the future.
// Written positively for the same three-valued-logic reason as isComplete above.
const isNotExpired = (s: Slot, today: Date): Prisma.StaffWhereInput => ({
  OR: [dateIs(s, null), dateIs(s, { gte: today })],
});

// ── Active / Inactive ────────────────────────────────────────────────────────
// Client rule: a staff member is ACTIVE only while ALL FOUR tracked documents are
// in order — uploaded AND still in date. One EXPIRED document makes them Inactive,
// and so does one MISSING document (no file, or no expiry date recorded). A
// document that is merely *expiring* has not lapsed yet, so those people stay
// Active. Nobody sets this by hand; it follows the documents automatically.
//
// In terms of the four computed statuses: Active = every slot VALID or
// EXPIRING_SOON. Inactive = any slot EXPIRED or MISSING.
//
// This is a DERIVED status. The Staff.employmentStatus column still exists and is
// what the nightly expiry scan uses to decide who to alert (see notifications.ts);
// it is deliberately NOT what the Status column and this filter read, so that a
// lapsed document can never silence its own alert.
// Both truncate to UTC midnight themselves. Expiry dates are stored at UTC
// midnight, so comparing against a raw `new Date()` would treat a document that
// expires TODAY as already lapsed and wrongly mark that person Inactive.
const startOfUTCDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// An admin can override the document rule for one person (Staff.statusOverride).
// Where that is set it wins outright; everyone else still follows their documents.
export const activeWhere = (now: Date): Prisma.StaffWhereInput => {
  const today = startOfUTCDay(now);
  return {
    OR: [
      { statusOverride: "ACTIVE" },
      { AND: [{ statusOverride: null }, ...DOC_SLOTS.map((s) => isComplete(s, today))] },
    ],
  };
};

export const inactiveWhere = (now: Date): Prisma.StaffWhereInput => {
  const today = startOfUTCDay(now);
  return {
    OR: [
      { statusOverride: "INACTIVE" },
      { AND: [{ statusOverride: null }, { OR: DOC_SLOTS.flatMap((s) => [isExpired(s, today), isMissing(s, today)]) }] },
    ],
  };
};

/**
 * Same rule, applied to statuses already computed by computeDocStatuses(). Reading
 * it off `worst` keeps the Status column and the Documents badge in lockstep: if the
 * badge says Expired or Missing, the row says Inactive.
 */
export function isActiveFromDocStatuses(d: { worst: ComputedStatus }): boolean {
  return d.worst === "VALID" || d.worst === "EXPIRING_SOON";
}

/**
 * The status to show for one person: the admin's override when there is one, else the
 * document rule. `overridden` lets a screen say why the badge disagrees with the docs.
 */
export function effectiveStatus(
  staff: { statusOverride?: "ACTIVE" | "INACTIVE" | null },
  docs: { worst: ComputedStatus },
): { status: "ACTIVE" | "INACTIVE"; overridden: boolean } {
  if (staff.statusOverride) return { status: staff.statusOverride, overridden: true };
  return { status: isActiveFromDocStatuses(docs) ? "ACTIVE" : "INACTIVE", overridden: false };
}

// Category and Location are free strings that may COMBINE two roles/sites with a
// slash — the real data holds FOH, FOH/COMMIS, COMMIS/FOH, FOH/RECEPTIONIST and
// FOH/STEWARD. Picking "FOH" must return every profile that carries FOH as one of
// its roles, not only the 37 whose value is exactly "FOH". Matching is on whole
// slash-separated tokens, so "FOH" never accidentally matches e.g. "BUFFOHAND".
export function slashTokenFilter(
  field: "category" | "location",
  value: string,
): Prisma.StaffWhereInput {
  const v = value.trim();
  const like = (k: "equals" | "startsWith" | "endsWith" | "contains", s: string) =>
    ({ [field]: { [k]: s, mode: "insensitive" } }) as Prisma.StaffWhereInput;
  return {
    OR: [
      like("equals", v), // FOH
      like("startsWith", `${v}/`), // FOH/COMMIS
      like("endsWith", `/${v}`), // COMMIS/FOH
      like("contains", `/${v}/`), // A/FOH/B
    ],
  };
}

export function buildStaffWhere(
  p: StaffParams,
  windowDays: number,
  now: Date = new Date(),
): Prisma.StaffWhereInput {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowEnd = new Date(today.getTime() + windowDays * 86_400_000);
  const AND: Prisma.StaffWhereInput[] = [];

  if (p.q) {
    const or: Prisma.StaffWhereInput[] = [
      { fullName: { contains: p.q, mode: "insensitive" } },
      { eidNumber: { contains: p.q, mode: "insensitive" } },
      { mobileNumber: { contains: p.q, mode: "insensitive" } },
      { category: { contains: p.q, mode: "insensitive" } },
      { location: { contains: p.q, mode: "insensitive" } },
      { residenceLocation: { contains: p.q, mode: "insensitive" } },
      { nationality: { contains: p.q, mode: "insensitive" } },
    ];
    // Dash/space-insensitive EID: match the digits of the query against eidDigits,
    // so "784199051551382" finds "784-1990-5155138-2".
    const qDigits = p.q.replace(/\D/g, "");
    if (qDigits) or.push({ eidDigits: { contains: qDigits } });
    AND.push({ OR: or });
  }
  // Derived from document expiry, not the stored column — see activeWhere above.
  if (p.status === "ACTIVE") AND.push(activeWhere(today));
  else if (p.status === "INACTIVE") AND.push(inactiveWhere(today));
  if (p.approval === "PENDING" || p.approval === "APPROVED") {
    AND.push({ approvalStatus: p.approval });
  }
  if (p.category) AND.push(slashTokenFilter("category", p.category));
  if (p.location) AND.push(slashTokenFilter("location", p.location));

  // These three buckets are MUTUALLY EXCLUSIVE and match the badge in the Documents
  // column, which shows a staff member's WORST document status. Filtering on "has at
  // least one expiring document" instead put people whose badge reads Expired into
  // the Expiring list (20 of them) and into Missing (54) — the same person appearing
  // under a heading that contradicts what their own row says.
  //
  // Severity order is EXPIRED > MISSING > EXPIRING_SOON > VALID, so:
  if (p.flag === "expired") {
    // Anything lapsed — nothing outranks it.
    AND.push({ OR: DOC_SLOTS.map((s) => isExpired(s, today)) });
  } else if (p.flag === "expiring") {
    // Expiring and nothing worse: every slot on file and in date, one within window.
    AND.push({ AND: DOC_SLOTS.map((s) => isComplete(s, today)) });
    AND.push({ OR: DOC_SLOTS.map((s) => isExpiring(s, today, windowEnd)) });
  } else if (p.flag === "missing") {
    // Missing and nothing worse: nothing lapsed, but a document absent.
    AND.push({ AND: DOC_SLOTS.map((s) => isNotExpired(s, today)) });
    AND.push({ OR: DOC_SLOTS.map((s) => isMissing(s, today)) });
  } else if (p.flag === "noexpired" || p.flag === "complete") {
    // "No expired documents" — the cleared-for-work set: every one of the four
    // tracked documents uploaded AND still in date. Nothing expired, nothing
    // missing. (Being complete already implies Active under the derived rule, so
    // no separate status condition is needed.)
    AND.push({ AND: DOC_SLOTS.map((s) => isComplete(s, today)) });
  } else if (p.flag === "noeid") {
    AND.push({ eidNumber: null });
  } else if (p.flag === "blacklisted") {
    AND.push({ blacklisted: true });
  }

  return AND.length ? { AND } : {};
}

const SORTABLE = new Set([
  "id", "fullName", "category", "location",
  "eidExpiry", "ohcExpiry", "bfhcExpiry", "passportExpiry", "employmentStatus",
]);

export function buildStaffOrderBy(sort: string, dir: "asc" | "desc"): Prisma.StaffOrderByWithRelationInput {
  const col = SORTABLE.has(sort) ? sort : "id";
  return { [col]: dir } as Prisma.StaffOrderByWithRelationInput;
}

export function staffQueryString(p: Partial<StaffParams>): string {
  const usp = new URLSearchParams();
  if (p.q) usp.set("q", p.q);
  if (p.status) usp.set("status", p.status);
  if (p.approval) usp.set("approval", p.approval);
  if (p.category) usp.set("category", p.category);
  if (p.location) usp.set("location", p.location);
  if (p.flag) usp.set("flag", p.flag);
  if (p.sort && p.sort !== "id") usp.set("sort", p.sort);
  if (p.dir && p.dir !== "asc") usp.set("dir", p.dir);
  if (p.page && p.page > 1) usp.set("page", String(p.page));
  return usp.toString();
}

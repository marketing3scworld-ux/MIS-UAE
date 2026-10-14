import type { Staff } from "@prisma/client";

// Missing/Expired document engine (spec §6). Phase 1 computes status from the
// imported expiry dates; Step 7 will also fold in "no file uploaded -> Missing".
export type ComputedStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "MISSING";

export type DocKey = "eid" | "ohc" | "bfhc" | "passport";
export const DOC_LABELS: Record<DocKey, string> = {
  eid: "EID",
  ohc: "OHC",
  bfhc: "BFHC",
  passport: "Passport",
};

const STATUS_SHORT: Record<ComputedStatus, string> = {
  VALID: "Valid",
  EXPIRING_SOON: "Expiring",
  EXPIRED: "Expired",
  MISSING: "Missing",
};

const SEVERITY: Record<ComputedStatus, number> = {
  VALID: 0,
  EXPIRING_SOON: 1,
  MISSING: 2,
  EXPIRED: 3,
};

function dayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// §6: Expiry<today -> Expired (first); no file OR no expiry -> Missing;
// within window -> Expiring; else Valid. hasFile defaults true (date-only mode,
// used before file info is available, e.g. the export snapshot).
export function statusFromDate(
  expiry: Date | null | undefined,
  windowDays: number,
  hasFile: boolean = true,
  now: Date = new Date(),
): ComputedStatus {
  const today = dayUTC(now);
  if (expiry) {
    const exp = dayUTC(new Date(expiry));
    if (exp < today) return "EXPIRED";
    if (!hasFile) return "MISSING";
    if (exp - today <= windowDays * 86_400_000) return "EXPIRING_SOON";
    return "VALID";
  }
  return "MISSING";
}

export type DocFilePresence = { eid?: boolean; ohc?: boolean; bfhc?: boolean; passport?: boolean };

export type StaffDocStatuses = {
  eid: ComputedStatus;
  ohc: ComputedStatus;
  bfhc: ComputedStatus;
  passport: ComputedStatus;
  worst: ComputedStatus;
  summary: string; // e.g. "OHC Expired, BFHC Missing"
};

type ExpiryFields = Pick<Staff, "eidExpiry" | "ohcExpiry" | "bfhcExpiry" | "passportExpiry">;

export function computeDocStatuses(
  s: ExpiryFields,
  windowDays: number,
  now: Date = new Date(),
  files?: DocFilePresence,
): StaffDocStatuses {
  const has = (k: keyof DocFilePresence) => (files ? !!files[k] : true);
  const entries: [DocKey, ComputedStatus][] = [
    ["eid", statusFromDate(s.eidExpiry, windowDays, has("eid"), now)],
    ["ohc", statusFromDate(s.ohcExpiry, windowDays, has("ohc"), now)],
    ["bfhc", statusFromDate(s.bfhcExpiry, windowDays, has("bfhc"), now)],
    ["passport", statusFromDate(s.passportExpiry, windowDays, has("passport"), now)],
  ];
  const problems = entries
    .filter(([, st]) => st !== "VALID")
    .map(([k, st]) => `${DOC_LABELS[k]} ${STATUS_SHORT[st]}`);
  const worst = entries.reduce<ComputedStatus>(
    (w, [, st]) => (SEVERITY[st] > SEVERITY[w] ? st : w),
    "VALID",
  );
  return {
    eid: entries[0][1],
    ohc: entries[1][1],
    bfhc: entries[2][1],
    passport: entries[3][1],
    worst,
    summary: problems.length ? problems.join(", ") : "All valid",
  };
}

export const STATUS_LABEL = STATUS_SHORT;

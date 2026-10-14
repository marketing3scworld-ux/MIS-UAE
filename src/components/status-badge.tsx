import { cn } from "@/lib/utils";
import type { ComputedStatus } from "@/lib/doc-status";

// Plain coloured status label — no pill, just the word in its status colour.
//
// Drives the "Documents" column in the staff list, which spec §6 requires to be
// colour-coded red / yellow / green. These map to the --color-status-* tokens in
// globals.css so the badge, the date cells and the dashboard charts cannot drift
// apart. Valid was previously blue, which matched nothing.
const STYLES: Record<ComputedStatus, string> = {
  VALID: "text-status-valid",
  EXPIRING_SOON: "text-status-expiring",
  EXPIRED: "text-status-expired",
  MISSING: "text-status-missing",
};

const LABELS: Record<ComputedStatus, string> = {
  VALID: "Valid",
  EXPIRING_SOON: "Expiring",
  EXPIRED: "Expired",
  MISSING: "Missing",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ComputedStatus;
  className?: string;
}) {
  return <span className={cn("text-xs font-semibold", STYLES[status], className)}>{LABELS[status]}</span>;
}

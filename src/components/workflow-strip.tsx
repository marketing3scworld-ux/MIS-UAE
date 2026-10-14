import Link from "next/link";
import type { DeploymentStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/deployment";
import { STAGES, type StageCounts } from "@/lib/workflow";
import { cn } from "@/lib/utils";

// The stages of a shift as a tab row — the same underlined tabs the Reports page uses,
// so filtering by stage looks like the rest of the app rather than a banner bolted on.

export function WorkflowStrip({
  counts,
  qs,
  current,
  needsMe,
}: {
  counts: StageCounts;
  qs: string; // current filters, without the status
  current?: string; // the status being filtered on, if any
  needsMe?: DeploymentStatus | null;
}) {
  const href = (s?: DeploymentStatus) =>
    `/deployments?${qs}${qs && s ? "&" : ""}${s ? `status=${s}` : ""}`;
  const total = STAGES.reduce((n, s) => n + counts[s], 0);

  const tab = (active: boolean) =>
    cn(
      "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
      active
        ? "border-brand-gold font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto border-b border-border">
        <Link href={href()} className={tab(!current)}>
          All
          <span className="tabular-nums text-xs text-muted-foreground">{total.toLocaleString()}</span>
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={href(s)} className={tab(current === s)}>
            {STATUS_LABEL[s]}
            <span className="tabular-nums text-xs text-muted-foreground">{counts[s].toLocaleString()}</span>
          </Link>
        ))}
        <Link href="/help" className="ms-auto hidden whitespace-nowrap px-3 py-2 text-xs text-muted-foreground hover:text-foreground sm:block">
          How this works
        </Link>
      </div>

      {needsMe ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {counts[needsMe].toLocaleString()} shift{counts[needsMe] === 1 ? " is" : "s are"} waiting to be{" "}
          {needsMe === "TIMESHEET_SUBMITTED" ? "verified" : "approved"} — select them in the list below.
        </p>
      ) : null}
    </div>
  );
}

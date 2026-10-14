import Link from "next/link";
import { CalendarPlus, Building2, ClipboardCheck, FileSpreadsheet } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  canApprove, canEnterTimesheet, canSchedule, canVerify, formatHM, toHours,
} from "@/lib/deployment";
import {
  parseDeploymentParams, loadDeployments, totalsOf, filterOptions, deploymentQueryString,
} from "@/lib/deployment-query";
import { toTableRow } from "@/lib/deployment-rows";
import { stageCounts, stageNeedingMe } from "@/lib/workflow";
import { WorkflowStrip } from "@/components/workflow-strip";
import { DeploymentFilters } from "./_components/deployment-filters";
import { DeploymentTable } from "./_components/deployment-table";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  const actor = { role: me!.role, isOperationsHead: me!.isOperationsHead };

  const p = parseDeploymentParams(await searchParams);
  const [rows, options, stages] = await Promise.all([loadDeployments(p), filterOptions(), stageCounts(p)]);
  const t = totalsOf(rows);
  const qs = deploymentQueryString(p);
  const qsNoStatus = deploymentQueryString({ ...p, status: "" });
  const needsMe = stageNeedingMe(stages, { verify: canVerify(actor), approve: canApprove(actor) });

  // Cancelled shifts are left out of every figure (totalsOf) — they did not happen.
  const kpi = [
    { label: "Shifts", value: t.shifts },
    { label: "Man-days", value: t.manDays },
    { label: "Scheduled hrs", value: t.scheduledHours },
    { label: "Actual hrs", value: t.actualHours },
    { label: "Overtime hrs", value: t.overtimeHours },
    { label: "Absences", value: t.absences },
    { label: "Replacements", value: t.replacements },
  ];
  const cancelled = rows.length - t.shifts;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Deployments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Schedule staff onto client events, record the hours they worked, then verify and approve
            them for payroll.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Link
            href="/deployments/clients"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
          >
            <Building2 className="h-4 w-4" /> Clients &amp; events
          </Link>
          {canEnterTimesheet(actor) ? (
            <Link
              href={`/deployments/timesheets?${qs}`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <ClipboardCheck className="h-4 w-4" /> Timesheets
            </Link>
          ) : null}
          <a
            href={`/deployments/export?${qs}`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export
          </a>
          {canSchedule(actor) ? (
            <Link
              href="/deployments/new"
              className="inline-flex items-center gap-2 rounded-md bg-brand-gold px-3 py-2 text-sm font-medium text-brand-navy-deep hover:bg-brand-gold/90"
            >
              <CalendarPlus className="h-4 w-4" /> Schedule staff
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <WorkflowStrip counts={stages} qs={qsNoStatus} current={p.status} needsMe={needsMe} />
      </div>

      <div className="mt-4">
        <DeploymentFilters options={options} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpi.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] font-medium text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-xl font-bold text-foreground">{k.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Variance across this selection:{" "}
        <strong className={t.varianceHours < 0 ? "text-status-expired" : "text-status-valid"}>
          {t.varianceHours > 0 ? "+" : ""}{t.varianceHours} h
        </strong>{" "}
        · {t.lateCount} late arrival{t.lateCount === 1 ? "" : "s"} · {t.earlyCount} early departure
        {t.earlyCount === 1 ? "" : "s"} · approved hours only feed payroll and invoicing.
        {cancelled ? ` ${cancelled} cancelled shift${cancelled === 1 ? " is" : "s are"} listed below but excluded from these figures.` : ""}
      </p>

      <div className="mt-4">
        <DeploymentTable
          rows={rows.map(toTableRow)}
          can={{
            deploy: canEnterTimesheet(actor),
            verify: canVerify(actor),
            approve: canApprove(actor),
            cancel: canSchedule(actor),
          }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {rows.length.toLocaleString()} deployment{rows.length === 1 ? "" : "s"} ·{" "}
        {formatHM(rows.reduce((a, r) => a + r.hours.actualMinutes, 0))} actual ({toHours(rows.reduce((a, r) => a + r.hours.actualMinutes, 0))} h)
      </p>
    </div>
  );
}

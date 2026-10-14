import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Download } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canApprove, canEnterTimesheet, canVerify } from "@/lib/deployment";
import { stageCounts, stageNeedingMe } from "@/lib/workflow";
import { WorkflowStrip } from "@/components/workflow-strip";
import { parseDeploymentParams, loadDeployments, deploymentQueryString } from "@/lib/deployment-query";
import { TimesheetUploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  if (!me || !canEnterTimesheet({ role: me.role, isOperationsHead: me.isOperationsHead })) {
    redirect("/deployments");
  }
  const actor = { role: me.role, isOperationsHead: me.isOperationsHead };

  const p = parseDeploymentParams(await searchParams);
  const qs = deploymentQueryString(p);
  const qsNoStatus = deploymentQueryString({ ...p, status: "" });
  const rows = await loadDeployments(p);
  const stages = await stageCounts(p);
  const open = rows.filter((r) => r.status !== "CANCELLED");
  const withHours = open.filter((r) => r.hours.hasActual || r.noShow).length;
  // Suggestions for the client / event of shifts created from a timesheet.
  const clients = (await prisma.client.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { name: true, projects: { where: { active: true }, orderBy: { name: "asc" }, select: { name: true } } },
  })).map((c) => ({ name: c.name, events: c.projects.map((p) => p.name) }));

  return (
    <div className="max-w-5xl">
      <Link href={`/deployments?${qs}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to deployments
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">Timesheets</h1>
        <Link href="/help" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          How this works →
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Send the venue a blank timesheet for the shifts you have scheduled, then upload what comes
        back — the Excel itself, a PDF, a photo of the signed sheet, or the venue&apos;s own
        spreadsheet. Recorded hours flow into the deployment report once they have been verified
        and approved.
      </p>

      <div className="mt-4">
        <WorkflowStrip
          counts={stages}
          qs={qsNoStatus}
          needsMe={stageNeedingMe(stages, { verify: canVerify(actor), approve: canApprove(actor) })}
        />
      </div>

      <ol className="mt-5 space-y-4">
        <li className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">1 — Download the blank timesheet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Covers <strong>{p.from}</strong> to <strong>{p.to}</strong> — {open.length} shift
                {open.length === 1 ? "" : "s"}
                {withHours ? `, ${withHours} of which already have hours recorded` : ""}. Change the
                dates or filters on the deployments page to cover a different set.
              </p>
            </div>
            <a
              href={`/deployments/timesheet-template?${qs}`}
              className="inline-flex flex-none items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <Download className="h-4 w-4" /> Download timesheet
            </a>
          </div>
          {open.length === 0 ? (
            <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
              There are no scheduled shifts in this date range, so the blank timesheet would come out
              empty. You can still upload the venue&apos;s own timesheet below — shifts that were not
              scheduled are created from it.
            </p>
          ) : null}
        </li>

        <li>
          <TimesheetUploadForm clients={clients} />
        </li>

        <li className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">3 — Verify, then approve</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded hours sit at <strong>Timesheet submitted</strong> until a supervisor verifies them
            and a manager approves them. Only approved hours appear in the Payroll, Client Chargeable
            and Actual Deployment reports.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/deployments?${qsNoStatus}${qsNoStatus ? "&" : ""}status=TIMESHEET_SUBMITTED`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <ClipboardCheck className="h-4 w-4" /> {stages.TIMESHEET_SUBMITTED} waiting to be verified
            </Link>
            <Link
              href={`/deployments?${qsNoStatus}${qsNoStatus ? "&" : ""}status=TIMESHEET_VERIFIED`}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <CheckCircle2 className="h-4 w-4" /> {stages.TIMESHEET_VERIFIED} waiting to be approved
            </Link>
          </div>
        </li>
      </ol>
    </div>
  );
}

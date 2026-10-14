import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Printer } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canApprove, canSeePay, canVerify } from "@/lib/deployment";
import { stageCounts, stageNeedingMe } from "@/lib/workflow";
import { WorkflowStrip } from "@/components/workflow-strip";
import {
  parseDeploymentParams, loadDeployments, filterOptions, deploymentQueryString,
} from "@/lib/deployment-query";
import { REPORTS, buildReport, type ReportKey } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { DeploymentFilters } from "../deployments/_components/deployment-filters";

export const dynamic = "force-dynamic";

const KEYS = REPORTS.map((r) => r.key);

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.r) ? sp.r[0] : sp.r;
  const key = (KEYS.includes(raw as ReportKey) ? raw : "actual") as ReportKey;

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  const actor = { role: me!.role, isOperationsHead: me!.isOperationsHead };

  // Payroll and chargeable hours are money; Accounts, HR and System Admin only.
  const restricted: ReportKey[] = ["payroll", "billing"];
  if (restricted.includes(key) && !canSeePay(actor)) redirect("/reports?r=actual");

  const p = parseDeploymentParams(sp);
  const [rows, options] = await Promise.all([loadDeployments(p), filterOptions()]);
  const doc = buildReport(key, p, rows);
  const qs = deploymentQueryString(p);
  const qsNoStatus = deploymentQueryString({ ...p, status: "" });
  const meta = REPORTS.find((r) => r.key === key)!;

  const tabs = REPORTS.filter((r) => !restricted.includes(r.key) || canSeePay(actor));

  // An approved-only report showing nothing almost always means the hours exist but are
  // still in the queue, so say where they are instead of just "nothing to report".
  const stages = await stageCounts(p);
  const waiting = stages.TIMESHEET_SUBMITTED + stages.TIMESHEET_VERIFIED;
  const stuck = meta.approvedOnly && doc.rows.length === 0 && waiting > 0;

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deployment, payroll and client-billing figures, all from the same approved timesheets.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((r) => (
          <Link
            key={r.key}
            href={`/reports?r=${r.key}${qs ? `&${qs}` : ""}`}
            className={cn(
              "-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              r.key === key
                ? "border-brand-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {r.title}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <DeploymentFilters options={options} showStatus={key === "variance"} />
        <div className="flex flex-none items-center gap-2">
          <a href={`/reports/export?r=${key}&format=xlsx&${qs}`} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90">
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </a>
          <a href={`/reports/export?r=${key}&format=pdf&${qs}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary">
            <Printer className="h-4 w-4" /> PDF
          </a>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{doc.title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta.blurb}</p>
        <p className="mt-1 text-xs text-muted-foreground">{doc.subtitle}</p>
        {meta.approvedOnly ? (
          <p className="mt-2 rounded-md bg-status-valid/10 px-2.5 py-1.5 text-[11px] text-status-valid">
            Approved timesheets only — unverified hours never reach payroll or an invoice.
          </p>
        ) : null}
        {stuck ? (
          <div className="mt-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground">
            <strong className="font-medium">This report is empty because those hours are not approved yet.</strong>
            <span className="ms-1 text-muted-foreground">
              In this date range {stages.TIMESHEET_SUBMITTED} shift{stages.TIMESHEET_SUBMITTED === 1 ? "" : "s"} still
              need verifying and {stages.TIMESHEET_VERIFIED} need approving.
            </span>
            <Link
              href={`/deployments?${qsNoStatus}${qsNoStatus ? "&" : ""}status=${stages.TIMESHEET_SUBMITTED ? "TIMESHEET_SUBMITTED" : "TIMESHEET_VERIFIED"}`}
              className="ms-1 font-medium underline underline-offset-2 hover:text-foreground"
            >
              Go and {stages.TIMESHEET_SUBMITTED ? "verify" : "approve"} them
            </Link>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <WorkflowStrip
          counts={stages}
          qs={qsNoStatus}
          needsMe={stageNeedingMe(stages, { verify: canVerify(actor), approve: canApprove(actor) })}
        />
      </div>

      <div className="mt-4 max-h-[65vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm" style={{ minWidth: `${Math.max(900, doc.cols.length * 130)}px` }}>
          <thead className="table-head sticky top-0">
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              {doc.cols.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap px-3 py-2.5 font-medium", c.numeric && "text-right")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.length === 0 ? (
              <tr>
                <td colSpan={doc.cols.length} className="p-10 text-center text-sm text-muted-foreground">
                  Nothing to report for these filters.
                </td>
              </tr>
            ) : doc.rows.map((r, i) => (
              <tr key={i} className="border-t border-border hover:bg-slate-50">
                {doc.cols.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap px-3 py-2", c.numeric && "text-right tabular-nums")}>
                    {r[c.key] === "" || r[c.key] === null || r[c.key] === undefined ? "—" : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {doc.totals && doc.rows.length ? (
            <tfoot className="sticky bottom-0">
              <tr className="border-t-2 border-brand-navy bg-secondary/60 font-semibold">
                {doc.cols.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap px-3 py-2.5", c.numeric && "text-right tabular-nums")}>
                    {doc.totals![c.key] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

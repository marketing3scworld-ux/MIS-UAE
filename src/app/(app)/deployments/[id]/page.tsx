import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  DEPLOYMENT_FLOW, STATUS_LABEL, STATUS_TONE, canEditApproved, canEnterTimesheet, canSchedule,
  computeHours, formatHM, formatTimeUTC, isAtOrAfter, toHours,
} from "@/lib/deployment";
import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimesheetForm } from "./timesheet-form";
import { EditShift } from "./edit-shift";

export const dynamic = "force-dynamic";

export default async function DeploymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) notFound();

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  const actor = { role: me!.role, isOperationsHead: me!.isOperationsHead };

  const d = await prisma.deployment.findUnique({
    where: { id },
    include: {
      staff: { select: { id: true, fullName: true, category: true, mobileNumber: true } },
      replacementStaff: { select: { id: true, fullName: true } },
      project: { select: { id: true, name: true, location: true, client: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      verifiedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      audits: {
        orderBy: { at: "desc" },
        take: 60,
        select: { id: true, action: true, field: true, oldValue: true, newValue: true, at: true, user: { select: { name: true } } },
      },
    },
  });
  if (!d) notFound();

  const h = computeHours(d);
  const [staffOptions, projects, shiftPresets, locationOptions, categoryOptions] = await Promise.all([
    prisma.staff.findMany({
      where: { blacklisted: false, id: { not: d.staffId } },
      orderBy: { fullName: "asc" },
      take: 500,
      select: { id: true, fullName: true },
    }),
    prisma.project.findMany({
      where: { OR: [{ active: true, client: { active: true } }, { id: d.projectId }] },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, client: { select: { name: true } } },
    }),
    prisma.shiftOption.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { value: "asc" }], select: { value: true, startTime: true, endTime: true } }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
    prisma.categoryOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);

  const isApproved = d.status === "APPROVED";
  const readOnly = !canEnterTimesheet(actor) || (isApproved && !canEditApproved(actor)) || d.status === "CANCELLED";
  const hhmm = (x: Date | null) => (x ? formatTimeUTC(x) : "");

  const facts: [string, React.ReactNode][] = [
    ["Client", titleCaseLabel(d.project.client.name)],
    ["Project / Event", titleCaseLabel(d.project.name)],
    ["Event date", formatDateUTC(d.eventDate)],
    ["Timesheet No.", d.timesheetNo ?? "—"],
    ["Location", titleCaseLabel(d.location ?? d.project.location ?? "") || "—"],
    ["Shift", titleCaseLabel(d.shift ?? "") || "—"],
    ["Staff Category", d.duty || "—"],
    ["Category at deployment", titleCaseLabel(d.category ?? "") || "—"],
    ["Scheduled", `${formatTimeUTC(d.startAt)} – ${formatTimeUTC(d.endAt)} (${formatHM(h.scheduledMinutes)})`],
    ["Unpaid break", d.breakMinutes ? `${d.breakMinutes} min` : "—"],
  ];

  const recon: [string, React.ReactNode][] = [
    ["Scheduled hours", `${toHours(h.scheduledMinutes)} h`],
    ["Actual hours", h.absent ? "—" : `${toHours(h.actualMinutes)} h`],
    ["Overtime", h.overtimeMinutes ? <span className="font-medium text-status-expiring">{formatHM(h.overtimeMinutes)}</span> : "—"],
    ["Variance", h.hasActual || h.absent
      ? <span className={cn("font-medium", h.varianceMinutes < 0 ? "text-status-expired" : "text-status-valid")}>
          {h.varianceMinutes > 0 ? "+" : ""}{formatHM(h.varianceMinutes)}
        </span>
      : "—"],
    ["Late arrival", h.lateMinutes ? <span className="font-medium text-status-expiring">{formatHM(h.lateMinutes)}</span> : "—"],
    ["Early departure", h.earlyDepartureMinutes ? <span className="font-medium text-status-expiring">{formatHM(h.earlyDepartureMinutes)}</span> : "—"],
    ["Absent", h.absent ? <span className="font-medium text-status-expired">Yes</span> : "No"],
    ["Replacement", d.replacementStaff
      ? <Link href={`/staff/${d.replacementStaff.id}`} className="font-medium text-brand-navy hover:underline">{titleCaseName(d.replacementStaff.fullName)}</Link>
      : "—"],
  ];

  return (
    <div className="max-w-[1400px]">
      <Link href="/deployments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to deployments
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            <Link href={`/staff/${d.staff.id}`} className="hover:underline">{titleCaseName(d.staff.fullName)}</Link>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deployment #{d.id} · Staff No. {d.staff.id} · {titleCaseLabel(d.project.client.name)} — {titleCaseLabel(d.project.name)}
          </p>
        </div>
        <span className={cn("rounded-lg border border-border px-3 py-1.5 text-sm font-semibold", STATUS_TONE[d.status])}>
          {STATUS_LABEL[d.status]}
        </span>
      </div>

      {/* Workflow position, so everyone can see what still has to happen. */}
      <ol className="mt-5 flex flex-wrap items-center gap-1 text-xs">
        {DEPLOYMENT_FLOW.map((s, i) => {
          const done = isAtOrAfter(d.status, s);
          return (
            <li key={s} className="flex items-center gap-1">
              <span className={cn(
                "rounded-full px-2.5 py-1 font-medium",
                done ? "bg-status-valid/10 text-status-valid" : "bg-secondary text-muted-foreground",
              )}>{STATUS_LABEL[s]}</span>
              {i < DEPLOYMENT_FLOW.length - 1 ? <span className="text-muted-foreground">→</span> : null}
            </li>
          );
        })}
        <li className="ms-2 text-muted-foreground">→ Payroll / Client billing</li>
      </ol>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Scheduled deployment</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-sm text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <EditShift
                deploymentId={d.id}
                initial={{
                  projectId: d.projectId,
                  eventDate: d.eventDate.toISOString().slice(0, 10),
                  startTime: formatTimeUTC(d.startAt),
                  endTime: formatTimeUTC(d.endAt),
                  breakMinutes: d.breakMinutes,
                  location: d.location ?? "",
                  shift: d.shift ?? "",
                  duty: d.duty ?? "",
                  category: d.category ?? "",
                  timesheetNo: d.timesheetNo ? String(d.timesheetNo) : "",
                  notes: d.notes ?? "",
                }}
                projects={projects.map((p) => ({ id: p.id, name: p.name, clientName: p.client.name }))}
                shifts={shiftPresets}
                locations={locationOptions.map((l) => l.value)}
                categories={categoryOptions.map((c) => c.value)}
                canEdit={canSchedule(actor) && d.status !== "CANCELLED" && (!isApproved || canEditApproved(actor))}
                canDelete={isApproved ? canEditApproved(actor) : canSchedule(actor)}
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Actual timesheet</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Times are wall-clock for the event date; an out-time earlier than the in-time is treated
              as finishing after midnight.
            </p>
            <div className="mt-4">
              <TimesheetForm
                deploymentId={d.id}
                initial={{
                  actualIn: hhmm(d.actualIn),
                  actualOut: hhmm(d.actualOut),
                  actualBreakMinutes: d.actualBreakMinutes ?? 0,
                  noShow: d.noShow,
                  replacementStaffId: d.replacementStaffId ? String(d.replacementStaffId) : "",
                  notes: d.notes ?? "",
                }}
                staffOptions={staffOptions}
                readOnly={readOnly}
                approvedWarning={isApproved && canEditApproved(actor)}
              />
            </div>
          </section>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Reconciliation</h2>
            <dl className="mt-3">
              {recon.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-sm text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Audit trail</h2>
            <p className="mt-1 text-xs text-muted-foreground">Who changed what, and when.</p>
            <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
              {d.audits.length === 0 ? <li className="text-xs text-muted-foreground">Nothing recorded yet.</li> : null}
              {d.audits.map((a) => (
                <li key={a.id} className="border-b border-border/60 pb-2 text-xs last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{a.action}</span>
                    <span className="text-muted-foreground">{a.at.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                  </div>
                  <div className="text-muted-foreground">
                    {a.user?.name ?? "system"}
                    {a.field ? <> · <span className="font-mono">{a.field}</span>: {a.oldValue ?? "—"} → {a.newValue ?? "—"}</> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
        <span>Created by {d.createdBy?.name ?? "—"} · {formatDateUTC(d.createdAt)}</span>
        {d.verifiedBy ? <span>Verified by {d.verifiedBy.name} · {formatDateUTC(d.verifiedAt)}</span> : null}
        {d.approvedBy ? <span>Approved by {d.approvedBy.name} · {formatDateUTC(d.approvedAt)}</span> : null}
      </div>
    </div>
  );
}

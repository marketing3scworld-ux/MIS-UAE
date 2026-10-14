import Link from "next/link";
import { BellOff, ShieldAlert } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { StatusBadge } from "@/components/status-badge";
import { DonutChart } from "@/components/donut-chart";
import { formatDateUTC, titleCaseName } from "@/lib/format";
import type { ComputedStatus } from "@/lib/doc-status";
import { resolveNotification, runScanNow } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;

const DOC_LABEL: Record<string, string> = {
  EID_FRONT: "Emirates ID",
  EID_BACK: "Emirates ID",
  PASSPORT: "Passport",
  OHC: "OHC",
  BFHC: "BFHC",
  BANK_PROOF: "Bank Proof",
};

export default async function NotificationsPage() {
  const session = await auth();
  const userId = Number(session!.user.id);
  const role = session!.user.role;
  const isAdmin = can(role, "settings:manage");

  // Ops / HR / Finance / Admin (viewAll) oversee ALL active alerts; Data-Entry
  // see only alerts addressed to them.
  const scope = can(role, "staff:viewAll") ? {} : { recipientId: userId };

  const activeWhere = { ...scope, state: { not: "RESOLVED" as const } };
  const [unviewed, totalActive, byStatus, byType, escalatedCount, notifs] = await Promise.all([
    prisma.notification.count({ where: { ...scope, state: "UNVIEWED" } }),
    prisma.notification.count({ where: activeWhere }),
    prisma.notification.groupBy({ by: ["docStatus"], where: activeWhere, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["documentType"], where: activeWhere, _count: { _all: true } }),
    prisma.notification.count({ where: { ...activeWhere, escalated: true } }),
    prisma.notification.findMany({
      where: activeWhere,
      orderBy: [{ state: "asc" }, { lastNotifiedAt: "desc" }],
      take: PAGE_LIMIT,
      include: { staff: { select: { id: true, fullName: true } } },
    }),
  ]);

  const expiredCount = byStatus.find((s) => s.docStatus === "EXPIRED")?._count._all ?? 0;
  const expiringCount = byStatus.find((s) => s.docStatus === "EXPIRING_SOON")?._count._all ?? 0;

  const typeCounts: Record<string, number> = {};
  for (const r of byType) {
    const label = DOC_LABEL[r.documentType] ?? r.documentType;
    typeCounts[label] = (typeCounts[label] ?? 0) + r._count._all;
  }
  const typeRows = ["Emirates ID", "OHC", "BFHC", "Passport"]
    .map((label) => ({ label, count: typeCounts[label] ?? 0 }))
    .filter((r) => r.count > 0);
  const typeMax = Math.max(1, ...typeRows.map((r) => r.count));

  return (
    <div className="max-w-[1400px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Notification Centre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalActive.toLocaleString()} active alert{totalActive === 1 ? "" : "s"}
            {unviewed > 0 ? ` · ${unviewed.toLocaleString()} unread` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <form action={runScanNow}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90"
              >
                <ShieldAlert className="h-4 w-4" /> Run expiry scan now
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {notifs.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <BellOff className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No active alerts. Documents nearing or past expiry appear here after the nightly scan.
          </p>
          {isAdmin ? (
            <form action={runScanNow} className="mt-2">
              <button type="submit" className="rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90">
                Run expiry scan now
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
          {notifs.map((n) => {
            const unread = n.state === "UNVIEWED";
            return (
              <div
                key={n.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 ${
                  unread ? "border-brand-gold/50" : "border-border"
                }`}
              >
                <StatusBadge status={n.docStatus as ComputedStatus} />
                <div className="min-w-[12rem] flex-1">
                  <div className="text-sm text-foreground">
                    <Link href={`/staff/${n.staffId}`} className="font-medium text-brand-navy hover:underline">
                      {titleCaseName(n.staff.fullName)}
                    </Link>{" "}
                    <span className="text-muted-foreground">· {DOC_LABEL[n.documentType] ?? n.documentType}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{n.message}</div>
                </div>
                <div className="flex flex-none items-center gap-2 text-xs text-muted-foreground">
                  {n.cycleCount > 1 ? <span title="Times re-notified">×{n.cycleCount}</span> : null}
                  {n.escalated ? (
                    <span className="rounded bg-status-expired/10 px-1.5 py-0.5 font-medium text-status-expired">Escalated</span>
                  ) : null}
                  <span className="whitespace-nowrap">{formatDateUTC(n.lastNotifiedAt)}</span>
                  <form action={resolveNotification.bind(null, n.id)}>
                    <button type="submit" className="rounded border border-border px-2 py-1 hover:bg-secondary">
                      Resolve
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
          {totalActive > notifs.length ? (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Showing the {notifs.length} most recent of {totalActive.toLocaleString()} active alerts.
            </p>
          ) : null}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Alert summary</h2>
              <div className="mt-4 flex items-center gap-4">
                <DonutChart
                  segments={[
                    { label: "Expired", value: expiredCount, color: "#ef4444" },
                    { label: "Expiring", value: expiringCount, color: "#f59e0b" },
                  ]}
                  centerTop={totalActive.toLocaleString()}
                  centerBottom="active"
                />
                <div className="flex-1 space-y-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
                    <span className="text-slate-500">Expired</span>
                    <span className="ml-auto font-semibold text-slate-800">{expiredCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                    <span className="text-slate-500">Expiring</span>
                    <span className="ml-auto font-semibold text-slate-800">{expiringCount.toLocaleString()}</span>
                  </div>
                  {unviewed > 0 ? (
                    <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#d3af37]" />
                      <span className="text-slate-500">Unread</span>
                      <span className="ml-auto font-semibold text-slate-800">{unviewed.toLocaleString()}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {typeRows.length > 0 ? (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-800">By document type</h2>
                <div className="mt-4 space-y-3">
                  {typeRows.map((t) => (
                    <div key={t.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-600">{t.label}</span>
                        <span className="text-slate-400">{t.count.toLocaleString()}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[#2f6bd8]" style={{ width: `${(t.count / typeMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {escalatedCount > 0 ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                  <ShieldAlert className="h-4 w-4" /> {escalatedCount.toLocaleString()} escalated
                </div>
                <p className="mt-1 text-xs text-rose-600/90">
                  Past the re-notify threshold — these need urgent attention.
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

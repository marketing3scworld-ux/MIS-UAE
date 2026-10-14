import type { CSSProperties } from "react";
import Link from "next/link";
import { Users, UserCheck, UserX, FileWarning, CalendarClock, FileX, Clock, IdCard, TrendingUp } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { buildExpiryReport, upcomingRenewals, DOC_KEYS } from "@/lib/expiry-report";
import { activeWhere } from "@/lib/staff-query";
import { DOC_LABELS, STATUS_LABEL, type ComputedStatus } from "@/lib/doc-status";
import { AreaChart } from "@/components/area-chart";
import { DonutChart } from "@/components/donut-chart";
import { Watchlist } from "@/components/watchlist";
import { StaffCalendar, type CalEvent } from "@/components/staff-calendar";
import { titleCaseName } from "@/lib/format";

export const dynamic = "force-dynamic";

// Charts need raw hex for SVG fills, so these mirror the --color-status-* tokens
// in globals.css (spec §6 traffic light). Keep the two in step.
const STATUS_COLOR: Record<ComputedStatus, string> = {
  VALID: "#16a34a", // green
  EXPIRING_SOON: "#d97706", // yellow
  EXPIRED: "#dc2626", // red
  MISSING: "#64748b", // slate
};
const DONUT_ORDER: ComputedStatus[] = ["VALID", "EXPIRING_SOON", "EXPIRED", "MISSING"];

export default async function DashboardPage() {
  const session = await auth();
  const { expiryWindowDays } = await getSettings();
  const now = new Date();

  const pad = (n: number) => String(n).padStart(2, "0");
  // Calendar window: this month through the next 3 full months (UTC).
  const calStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const calEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 1));

  // Active vs Inactive = employment status. Only staff with completed documents
  // are ACTIVE; the rest are INACTIVE. The expiry engine/report count ACTIVE only.
  // All operational KPIs are scoped to the ACTIVE workforce, consistent with the
  // expiry report (which only counts ACTIVE staff).
  // Active/Inactive is DERIVED from document expiry (see activeWhere): one lapsed
  // document makes someone Inactive. These three KPIs drill through to
  // /staff?status=ACTIVE, so they must use the same rule or the count you click
  // won't match the list that opens.
  const active = activeWhere(now);
  const [total, activeCount, pending, noEid, report, renewals, calStaff] = await Promise.all([
    prisma.staff.count(),
    prisma.staff.count({ where: active }),
    prisma.staff.count({ where: { AND: [{ approvalStatus: "PENDING" }, active] } }),
    prisma.staff.count({ where: { AND: [{ eidNumber: null }, active] } }),
    buildExpiryReport(expiryWindowDays, now),
    upcomingRenewals(now, 12),
    prisma.staff.findMany({
      where: {
        employmentStatus: "ACTIVE",
        OR: [
          { eidExpiry: { gte: calStart, lt: calEnd } },
          { ohcExpiry: { gte: calStart, lt: calEnd } },
          { bfhcExpiry: { gte: calStart, lt: calEnd } },
          { passportExpiry: { gte: calStart, lt: calEnd } },
        ],
      },
      select: { id: true, fullName: true, eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true },
    }),
  ]);

  // Build per-day document-expiry events for the calendar.
  const windowEnd = new Date(now.getTime() + expiryWindowDays * 86400000);
  const dayKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const calEvents: CalEvent[] = [];
  for (const s of calStaff) {
    const fields: [Date | null, string][] = [
      [s.eidExpiry, "EID"],
      [s.ohcExpiry, "OHC"],
      [s.bfhcExpiry, "BFHC"],
      [s.passportExpiry, "Passport"],
    ];
    for (const [d, label] of fields) {
      if (!d || d < calStart || d >= calEnd) continue;
      const status: CalEvent["status"] = d < now ? "EXPIRED" : d <= windowEnd ? "EXPIRING_SOON" : "UPCOMING";
      calEvents.push({ date: dayKey(d), staffId: s.id, staffName: titleCaseName(s.fullName), docType: label, status });
    }
  }
  const todayKey = dayKey(now);
  const initialMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;

  // Watchlist: staff ranked by their expired / expiring documents.
  const attention = new Map<number, { staffId: number; staffName: string; expired: number; expiring: number }>();
  for (const p of report.problems) {
    if (p.status !== "EXPIRED" && p.status !== "EXPIRING_SOON") continue;
    const e =
      attention.get(p.staffId) ??
      attention.set(p.staffId, { staffId: p.staffId, staffName: p.staffName, expired: 0, expiring: 0 }).get(p.staffId)!;
    if (p.status === "EXPIRED") e.expired += 1;
    else e.expiring += 1;
  }
  const attList = [...attention.values()];
  const topExpired = attList
    .filter((s) => s.expired > 0)
    .sort((a, b) => b.expired - a.expired)
    .slice(0, 6)
    .map((s) => ({ staffId: s.staffId, staffName: titleCaseName(s.staffName), count: s.expired }));
  const topExpiring = attList
    .filter((s) => s.expiring > 0)
    .sort((a, b) => b.expiring - a.expiring)
    .slice(0, 6)
    .map((s) => ({ staffId: s.staffId, staffName: titleCaseName(s.staffName), count: s.expiring }));

  const renewalTotal = renewals.reduce((a, b) => a + b.value, 0);
  const inactiveCount = total - activeCount;

  const kpis = [
    { label: "Total Staff", value: total, icon: Users, href: "/staff", color: "#4f8cf0" },
    { label: "Active", value: activeCount, icon: UserCheck, href: "/staff?status=ACTIVE", color: "#3fb4a2" },
    { label: "Inactive", value: inactiveCount, icon: UserX, href: "/staff?status=INACTIVE", color: "#e0605f" },
    { label: "Expired Docs", value: report.totals.EXPIRED, icon: FileX, href: "/documents?status=expired", color: "#e06c8a" },
    { label: "Expiring Soon", value: report.totals.EXPIRING_SOON, icon: CalendarClock, href: "/documents?status=expiring", color: "#e1a458" },
    { label: "Missing Docs", value: report.totals.MISSING, icon: FileWarning, href: "/documents?status=missing", color: "#8896b0" },
    { label: "Pending Approval", value: pending, icon: Clock, href: "/staff?approval=PENDING&status=ACTIVE", color: "#7c8cf0" },
    { label: "No EID on File", value: noEid, icon: IdCard, href: "/staff?flag=noeid&status=ACTIVE", color: "#67b7c9" },
  ];

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] bg-[#eef2f8] p-4 text-slate-700 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">
              Document compliance across {activeCount.toLocaleString()} active staff · expiry window {expiryWindowDays} days.
            </p>
          </div>
          <span className="text-sm text-slate-400">Welcome back, {session?.user?.name}</span>
        </div>

        {/* Document calendar — staff document expiries marked per day */}
        <StaffCalendar events={calEvents} initialMonth={initialMonth} todayKey={todayKey} />

        {/* KPI cards */}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, href, color }) => (
            <Link
              key={label}
              href={href}
              className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <span className="glass-icon h-9 w-9" style={{ "--ic": color } as CSSProperties}>
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-800">{value.toLocaleString()}</div>
            </Link>
          ))}
        </div>

        {/* Renewals chart */}
        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <TrendingUp className="h-4 w-4 text-[#2f6bd8]" /> Upcoming document renewals
              </h2>
              <p className="mt-1 text-3xl font-bold text-slate-800">
                {renewalTotal.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-slate-400">documents expiring · next 12 months</span>
              </p>
            </div>
            <Link href="/documents?status=expiring" className="text-xs font-semibold text-[#2f6bd8] hover:underline">
              View report →
            </Link>
          </div>
          <div className="mt-4">
            <AreaChart data={renewals} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Document status donuts */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Document status by type</h2>
              <Link href="/documents" className="text-xs font-semibold text-[#2f6bd8] hover:underline">
                Renewals report →
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
              {DOC_KEYS.map((key) => {
                const row = report.matrix[key];
                const typeTotal = DONUT_ORDER.reduce((a, st) => a + row[st], 0);
                const validPct = typeTotal ? Math.round((row.VALID / typeTotal) * 100) : 0;
                const segments = DONUT_ORDER.map((st) => ({
                  label: STATUS_LABEL[st],
                  value: row[st],
                  color: STATUS_COLOR[st],
                }));
                return (
                  <div key={key} className="flex flex-col items-center">
                    <DonutChart segments={segments} centerTop={`${validPct}%`} centerBottom="valid" />
                    <div className="mt-2 text-sm font-semibold text-slate-700">{DOC_LABELS[key]}</div>
                    <div className="text-xs text-slate-400">
                      {row.EXPIRED} expired · {row.EXPIRING_SOON} expiring
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
              {DONUT_ORDER.map((st) => (
                <span key={st} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[st] }} /> {STATUS_LABEL[st]}
                </span>
              ))}
            </div>
          </div>

          {/* Needs attention (watchlist) */}
          <Watchlist expired={topExpired} expiring={topExpiring} />
        </div>
      </div>
    </div>
  );
}

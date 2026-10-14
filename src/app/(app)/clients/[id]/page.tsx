import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Search } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule, computeHours, toHours, STATUS_LABEL, STATUS_TONE } from "@/lib/deployment";
import { formatDateUTC, titleCaseLabel, titleCaseName } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A client's profile: their projects, and everyone deployed to them.
 *
 * "Assigned staff" is derived from deployments rather than stored as its own
 * relation — a person belongs to a client because they worked for them, and that
 * fact already lives on the Deployment row. Storing it twice would let the two
 * disagree.
 *
 * The search box matches staff number, name OR Emirates ID (dash-insensitive, via
 * the eidDigits column), so an operator holding someone's EID card can find them.
 */
export default async function ClientProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) notFound();

  const sp = await searchParams;
  const q = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim();

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  const canPlan = !!me && canSchedule({ role: me.role, isOperationsHead: me.isOperationsHead });

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true, name: true, active: true, createdAt: true,
      projects: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, location: true, active: true, _count: { select: { deployments: true } } },
      },
    },
  });
  if (!client) notFound();

  // Every deployment for this client, with the staff who worked it.
  const deployments = await prisma.deployment.findMany({
    where: { project: { clientId: id }, status: { not: "CANCELLED" } },
    orderBy: [{ eventDate: "desc" }, { startAt: "asc" }],
    select: {
      id: true, eventDate: true, status: true, startAt: true, endAt: true, breakMinutes: true,
      actualIn: true, actualOut: true, actualBreakMinutes: true, noShow: true,
      replacementStaffId: true, category: true, location: true, shift: true,
      project: { select: { name: true } },
      staff: { select: { id: true, fullName: true, eidNumber: true, eidDigits: true, category: true, mobileNumber: true } },
      replacementStaff: { select: { id: true, fullName: true, eidNumber: true, eidDigits: true, category: true, mobileNumber: true } },
    },
  });

  // Roll up per person — whoever actually worked the shift owns its hours.
  type Person = {
    id: number; fullName: string; eidNumber: string | null; eidDigits: string | null;
    category: string | null; mobile: string | null;
    shifts: number; hours: number; lastDate: Date; projects: Set<string>;
  };
  const byStaff = new Map<number, Person>();
  let totalMinutes = 0;
  for (const d of deployments) {
    const worked = d.replacementStaff ?? d.staff;
    const h = computeHours(d);
    totalMinutes += h.actualMinutes;
    const cur = byStaff.get(worked.id) ?? {
      id: worked.id, fullName: worked.fullName, eidNumber: worked.eidNumber, eidDigits: worked.eidDigits,
      category: d.category ?? worked.category, mobile: worked.mobileNumber,
      shifts: 0, hours: 0, lastDate: d.eventDate, projects: new Set<string>(),
    };
    cur.shifts += 1;
    cur.hours += h.actualMinutes;
    cur.projects.add(d.project.name);
    if (d.eventDate > cur.lastDate) cur.lastDate = d.eventDate;
    byStaff.set(worked.id, cur);
  }

  // Staff number, name, or Emirates ID with or without dashes.
  const needle = q.toUpperCase();
  const digits = q.replace(/\D/g, "");
  const people = [...byStaff.values()]
    .filter((p) => {
      if (!q) return true;
      if (String(p.id) === q) return true;
      if (p.fullName.toUpperCase().includes(needle)) return true;
      if (p.eidNumber && p.eidNumber.toUpperCase().includes(needle)) return true;
      if (digits && p.eidDigits && p.eidDigits.includes(digits)) return true;
      return false;
    })
    .sort((a, b) => b.shifts - a.shifts || a.fullName.localeCompare(b.fullName));

  const kpi = [
    { label: "Events", value: client.projects.length },
    { label: "Deployments", value: deployments.length },
    { label: "Staff assigned", value: byStaff.size },
    { label: "Hours worked", value: toHours(totalMinutes) },
  ];
  const recent = deployments.slice(0, 8);

  return (
    <div className="max-w-[1400px]">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {titleCaseLabel(client.name)}
            {!client.active ? (
              <span className="ms-2 rounded bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">Disabled</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Client since {formatDateUTC(client.createdAt)} · everyone below has worked for them.
          </p>
        </div>
        {canPlan ? (
          <Link
            href={`/deployments/new?clientId=${client.id}`}
            className="inline-flex items-center gap-2 rounded-md bg-brand-gold px-3 py-2 text-sm font-medium text-brand-navy-deep hover:bg-brand-gold/90"
          >
            <CalendarPlus className="h-4 w-4" /> Schedule staff here
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpi.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] font-medium text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-xl font-bold text-foreground">{k.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Assigned staff <span className="font-normal text-muted-foreground">({people.length})</span>
            </h2>
            <form className="relative" action={`/clients/${client.id}`}>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search staff no., name or EID…"
                className="w-64 rounded-md border border-input bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-gold"
              />
            </form>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Emirates ID matches with or without dashes — 784-1990-5155138-2 and 784199051551382 both work.
          </p>

          <div className="mt-3 max-h-[520px] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="table-head sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  {["No.", "Name", "EID Number", "Category", "Shifts", "Hours", "Last worked"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                      {q
                        ? `No staff assigned to this client match “${q}”.`
                        : "Nobody has been deployed to this client yet."}
                    </td>
                  </tr>
                ) : people.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-slate-50">
                    <td className="px-3 py-2 text-muted-foreground">{p.id}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/staff/${p.id}`} className="font-medium text-brand-navy hover:underline">
                        {titleCaseName(p.fullName)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {p.eidNumber ?? <span className="font-sans text-status-missing">No EID</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{titleCaseLabel(p.category ?? "") || "—"}</td>
                    <td className="px-3 py-2">{p.shifts}</td>
                    <td className="px-3 py-2 tabular-nums">{toHours(p.hours)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateUTC(p.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Events</h2>
            <ul className="mt-3 space-y-2">
              {client.projects.length === 0 ? (
                <li className="text-xs text-muted-foreground">No events yet.</li>
              ) : client.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className={p.active ? "text-sm text-foreground" : "text-sm text-muted-foreground line-through"}>
                      {titleCaseLabel(p.name)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.location ? titleCaseLabel(p.location) : "no default location"}
                    </div>
                  </div>
                  <span className="flex-none text-xs text-muted-foreground">{p._count.deployments}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Recent deployments</h2>
            <ul className="mt-3 space-y-2">
              {recent.length === 0 ? (
                <li className="text-xs text-muted-foreground">Nothing scheduled yet.</li>
              ) : recent.map((d) => (
                <li key={d.id} className="border-b border-border/60 pb-2 text-xs last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/deployments/${d.id}`} className="font-medium text-brand-navy hover:underline">
                      {titleCaseName((d.replacementStaff ?? d.staff).fullName)}
                    </Link>
                    <span className={cn("font-semibold", STATUS_TONE[d.status])}>{STATUS_LABEL[d.status]}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {formatDateUTC(d.eventDate)} · {titleCaseLabel(d.project.name)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

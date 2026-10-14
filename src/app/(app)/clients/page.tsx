import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule } from "@/lib/deployment";
import { titleCaseLabel } from "@/lib/format";
import { ClientProjectForms } from "./forms";
import { ClientRowActions, ProjectRowActions } from "./row-actions";
import { toggleClient, toggleProject } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  const canEdit = !!me && canSchedule({ role: me.role, isOperationsHead: me.isOperationsHead });

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, active: true,
      projects: {
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, location: true, active: true,
          _count: { select: { deployments: true } },
        },
      },
    },
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-foreground">Clients &amp; events</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Staff are scheduled onto an event, never onto a client directly — that way one client can
        run several venues at once. Add each event as it is booked. Open a client to see everyone
        deployed to them. Disabling hides it from the scheduling form without touching deployments
        already recorded.
      </p>

      {canEdit ? <div className="mt-5"><ClientProjectForms clients={clients.map((c) => ({ id: c.id, name: c.name }))} /></div> : null}

      <div className="mt-6 space-y-4">
        {clients.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No clients yet.
          </p>
        ) : clients.map((c) => (
          <section key={c.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                <Link href={`/clients/${c.id}`} className="text-brand-navy hover:underline">
                  {titleCaseLabel(c.name)}
                </Link>
                {!c.active ? <span className="ms-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">Disabled</span> : null}
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  {c.projects.length} event{c.projects.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <Link href={`/clients/${c.id}`} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary">
                  Open profile <ChevronRight className="h-3 w-3" />
                </Link>
                {canEdit ? (
                  <>
                    <form action={toggleClient.bind(null, c.id, !c.active)}>
                      <button type="submit" className="rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary">
                        {c.active ? "Disable" : "Enable"}
                      </button>
                    </form>
                    <ClientRowActions id={c.id} name={c.name} />
                  </>
                ) : null}
              </div>
            </div>

            {c.projects.length ? (
              <ul className="mt-3 divide-y divide-border">
                {c.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className={p.active ? "text-sm text-foreground" : "text-sm text-muted-foreground line-through"}>
                        {titleCaseLabel(p.name)}
                      </span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {p.location ? titleCaseLabel(p.location) : "no default location"} · {p._count.deployments} deployment
                        {p._count.deployments === 1 ? "" : "s"}
                      </span>
                    </div>
                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <form action={toggleProject.bind(null, p.id, !p.active)}>
                          <button type="submit" className="rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary">
                            {p.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                        <ProjectRowActions id={p.id} name={p.name} location={p.location} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No events for this client yet.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

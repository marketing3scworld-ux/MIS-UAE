import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule } from "@/lib/deployment";
import { computeDocStatuses } from "@/lib/doc-status";
import { getSettings } from "@/lib/settings";
import { ScheduleForm, type PickableStaff } from "./schedule-form";

export const dynamic = "force-dynamic";

export default async function NewDeploymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: Number(session!.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  if (!me || !canSchedule({ role: me.role, isOperationsHead: me.isOperationsHead })) {
    redirect("/deployments");
  }

  const { expiryWindowDays } = await getSettings();
  const now = new Date();

  const [projects, clients, staff, shifts, locs] = await Promise.all([
    prisma.project.findMany({
      where: { active: true, client: { active: true } },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, location: true, client: { select: { id: true, name: true } } },
    }),
    prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.staff.findMany({
      where: { blacklisted: false },
      orderBy: { fullName: "asc" },
      select: {
        id: true, fullName: true, category: true, location: true,
        eidExpiry: true, ohcExpiry: true, bfhcExpiry: true, passportExpiry: true,
        documents: { where: { isCurrent: true }, select: { type: true } },
      },
    }),
    prisma.shiftOption.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
      select: { value: true, startTime: true, endTime: true },
    }),
    prisma.locationOption.findMany({ where: { active: true }, orderBy: { value: "asc" }, select: { value: true } }),
  ]);

  // Blacklisted staff are excluded outright; everyone else is offered, with their
  // Phase-1 document status shown so a scheduler sees the risk before committing.
  const pickable: PickableStaff[] = staff.map((s) => {
    const t = new Set(s.documents.map((d) => d.type));
    const docs = computeDocStatuses(s, expiryWindowDays, now, {
      eid: t.has("EID_FRONT") || t.has("EID_BACK"),
      ohc: t.has("OHC"),
      bfhc: t.has("BFHC"),
      passport: t.has("PASSPORT"),
    });
    const compliant = docs.worst === "VALID" || docs.worst === "EXPIRING_SOON";
    return {
      id: s.id,
      fullName: s.fullName,
      category: s.category ?? "",
      location: s.location ?? "",
      compliant,
      issue: compliant ? "" : docs.summary,
    };
  });

  // Arriving from a client profile ("Schedule staff here"). If that client already
  // has events, open on their first one; if not, open the new-event fields with the
  // client name filled in. Either way the scheduler lands ready to pick people.
  const wantProject = one("projectId");
  const wantClient = one("clientId");
  const clientProjects = wantClient ? projects.filter((p) => String(p.client.id) === wantClient) : [];
  const preselectProjectId =
    wantProject || (clientProjects.length ? String(clientProjects[0].id) : wantClient ? "__new__" : undefined);
  const preselectClient = wantClient
    ? clients.find((c) => String(c.id) === wantClient)?.name
    : undefined;

  // Opens on today, because most rosters are entered for the day they are worked.
  // The field is a date picker: change it for anything scheduled ahead, and it stays
  // editable on the shift afterwards.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString().slice(0, 10);

  return (
    <div className="max-w-[1400px]">
      <Link href="/deployments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to deployments
      </Link>
      <h1 className="mt-3 text-xl font-semibold text-foreground">Schedule staff</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Assign staff from the database to a client event for a dated shift. The date opens on
        today — change it for anything scheduled ahead.
      </p>

      {/* No empty-state gate. With no projects yet the form simply opens on its
          "new client / event" fields, so scheduling always starts where the work
          is — picking staff — instead of bouncing to another screen. */}
      <div className="mt-5">
        <ScheduleForm
          projects={projects.map((p) => ({
            id: p.id, name: p.name, clientName: p.client.name, location: p.location ?? "",
          }))}
          clients={clients.map((c) => c.name)}
          staff={pickable}
          shifts={shifts}
          locations={locs.map((l) => l.value)}
          defaultDate={today}
          preselectProjectId={preselectProjectId}
          preselectClient={preselectClient}
        />
      </div>
    </div>
  );
}

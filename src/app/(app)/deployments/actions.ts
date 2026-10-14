"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  buildShiftRange, canApprove, canEditApproved, canEnterTimesheet, canSchedule, canVerify,
  isAtOrAfter, type Actor,
} from "@/lib/deployment";
import type { DeploymentStatus, Prisma } from "@prisma/client";

// Every mutation goes through here. Two rules hold throughout:
//   1. Nothing reaches payroll or an invoice without passing the approval chain.
//   2. Any change to an approved row is recorded AND sends the row back for
//      re-approval, so approved figures can never silently move under Accounts.

async function actor(): Promise<{ id: number; a: Actor } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { id: true, role: true, isOperationsHead: true },
  });
  if (!me) return null;
  return { id: me.id, a: { role: me.role, isOperationsHead: me.isOperationsHead } };
}

async function audit(
  tx: Prisma.TransactionClient,
  deploymentId: number,
  userId: number,
  action: string,
  changes: { field: string; from: unknown; to: unknown }[] = [],
) {
  const str = (v: unknown) =>
    v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
  if (!changes.length) {
    await tx.deploymentAudit.create({ data: { deploymentId, userId, action } });
    return;
  }
  await tx.deploymentAudit.createMany({
    data: changes.map((c) => ({
      deploymentId, userId, action, field: c.field, oldValue: str(c.from), newValue: str(c.to),
    })),
  });
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const [k, v] of Object.entries(after)) {
    const b = before[k];
    const same = b instanceof Date && v instanceof Date ? b.getTime() === v.getTime() : b === v;
    if (!same) out.push({ field: k, from: b, to: v });
  }
  return out;
}

const revalidateAll = () => {
  revalidatePath("/deployments");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
};

// ── Create ──────────────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  // Either pick an existing project, or name a new client/project inline. Forcing a
  // detour to a separate screen before you can roster anyone is what made the old
  // flow dead-end on an empty database.
  projectId: z.coerce.number().int().optional(),
  newClient: z.string().optional(),
  newProject: z.string().optional(),
  eventDate: z.string().min(10),
  startTime: z.string().min(4),
  endTime: z.string().min(4),
  breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
  location: z.string().optional(),
  shift: z.string().optional(),
  duty: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * One shift as it was just created, handed back to the scheduling screen so a wrong
 * date or time can be corrected — or the shift removed — without going looking for it
 * on the deployments list first.
 */
export type ScheduledShift = {
  id: number;
  staffName: string;
  projectId: number;
  clientName: string;
  projectName: string;
  eventDate: string; // yyyy-mm-dd
  startTime: string; // HH:MM
  endTime: string;
  breakMinutes: number;
  location: string;
  shift: string;
  duty: string;
  category: string;
  timesheetNo: string;
  notes: string;
};

export type ScheduleState = { ok?: string; error?: string; conflicts?: string[]; created?: ScheduledShift[] };

/**
 * Schedule one or more staff onto a project for a shift. Staff are picked from the
 * existing database — this never creates a profile.
 */
export async function scheduleStaff(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canSchedule(me.a)) return { error: "You do not have permission to schedule staff." };

  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Name the offending fields — "check the details" on a 10-field form is useless.
    const bad = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].filter(Boolean);
    return { error: `Please check the shift details${bad.length ? `: ${bad.join(", ")}` : ""}.` };
  }
  const f = parsed.data;

  const staffIds = formData.getAll("staffIds").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  if (!staffIds.length) return { error: "Select at least one staff member." };

  const { startAt, endAt } = buildShiftRange(f.eventDate, f.startTime, f.endTime);
  if (endAt <= startAt) return { error: "The shift must end after it starts." };

  const eventDate = new Date(`${f.eventDate}T00:00:00.000Z`);

  // Resolve the project: an existing one, or create the client/project on the fly.
  // The names come back too, so the screen can name each shift it just created.
  let project: { id: number; location: string | null; name: string; client: { name: string } } | null = null;
  if (f.projectId && f.projectId > 0) {
    project = await prisma.project.findUnique({
      where: { id: f.projectId },
      select: { id: true, location: true, name: true, client: { select: { name: true } } },
    });
    if (!project) return { error: "That event no longer exists." };
  } else {
    const clientName = (f.newClient ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    // The event name is optional: plenty of work is "just the client", so an empty
    // name files the shift under an event named after the client itself.
    const projectName = (f.newProject ?? "").replace(/\s+/g, " ").trim().toUpperCase() || clientName;
    if (!clientName) return { error: "Choose an existing event, or give a client name." };
    const client = await prisma.client.upsert({
      where: { name: clientName },
      update: { active: true },
      create: { name: clientName },
      select: { id: true },
    });
    project = await prisma.project.upsert({
      where: { clientId_name: { clientId: client.id, name: projectName } },
      update: { active: true },
      create: { clientId: client.id, name: projectName, location: f.location?.toUpperCase() || null },
      select: { id: true, location: true, name: true, client: { select: { name: true } } },
    });
  }

  const people = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, fullName: true, category: true },
  });

  // Pre-check overlaps so the user gets names rather than a database error. The
  // exclusion constraint on Deployment is still the real guarantee against two
  // schedulers racing each other.
  const clashes = await prisma.deployment.findMany({
    where: {
      staffId: { in: staffIds },
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { staffId: true, project: { select: { name: true } } },
  });
  const clashBy = new Map(clashes.map((c) => [c.staffId, c]));
  const conflicts = people
    .filter((p) => clashBy.has(p.id))
    .map((p) => `${p.fullName} — already on ${clashBy.get(p.id)!.project.name}`);

  const toCreate = people.filter((p) => !clashBy.has(p.id));
  if (!toCreate.length) {
    return { error: "Every selected person is already booked for an overlapping shift.", conflicts };
  }

  let created = 0;
  const createdShifts: ScheduledShift[] = [];
  const location = (f.location || project.location || "").toUpperCase() || null;
  for (const p of toCreate) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        const d = await tx.deployment.create({
          data: {
            projectId: project.id,
            staffId: p.id,
            eventDate,
            startAt,
            endAt,
            breakMinutes: f.breakMinutes,
            location,
            shift: f.shift ? f.shift.toUpperCase() : null,
            duty: f.duty || null,
            category: p.category, // frozen at deployment time
            notes: f.notes || null,
            createdById: me.id,
            updatedById: me.id,
          },
          select: { id: true },
        });
        await audit(tx, d.id, me.id, "created");
        return d.id;
      });
      created++;
      createdShifts.push({
        id,
        staffName: p.fullName,
        projectId: project.id,
        clientName: project.client.name,
        projectName: project.name,
        eventDate: f.eventDate,
        startTime: f.startTime,
        endTime: f.endTime,
        breakMinutes: f.breakMinutes,
        location: location ?? "",
        shift: f.shift ? f.shift.toUpperCase() : "",
        duty: f.duty || "",
        category: p.category ?? "",
        timesheetNo: "",
        notes: f.notes || "",
      });
    } catch (e) {
      // The database constraint fired — someone else booked them a moment ago.
      conflicts.push(`${p.fullName} — booking clashed, skipped`);
      console.error("[deployment:create]", p.id, e);
    }
  }

  revalidateAll();
  return {
    ok: `Saved ${created} shift${created === 1 ? "" : "s"}.`,
    conflicts: conflicts.length ? conflicts : undefined,
    created: createdShifts.length ? createdShifts : undefined,
  };
}

// ── Edit a scheduled shift ──────────────────────────────────────────────────

const editSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  eventDate: z.string().min(10),
  startTime: z.string().min(4),
  endTime: z.string().min(4),
  breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
  location: z.string().optional(),
  shift: z.string().optional(),
  duty: z.string().optional(), // shown as "Staff Category"
  category: z.string().optional(),
  timesheetNo: z.string().optional(),
  notes: z.string().optional(),
});

export type EditState = { ok?: string; error?: string };

/**
 * Change anything about a shift that was got wrong when it was created: the date, the
 * times, the client/event, the break, the staff category, the venue's timesheet
 * number. Hours are recomputed from the new times, so an approved row goes back for
 * re-approval exactly as it does when the actuals are edited.
 */
export async function updateDeployment(id: number, _prev: EditState, formData: FormData): Promise<EditState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canSchedule(me.a)) return { error: "You do not have permission to change a shift." };

  const d = await prisma.deployment.findUnique({ where: { id } });
  if (!d) return { error: "This shift no longer exists." };
  if (d.status === "CANCELLED") return { error: "This shift was cancelled. Schedule a new one instead." };
  if (d.status === "APPROVED" && !canEditApproved(me.a)) {
    return { error: "This is approved. Only HR/Admin can change approved hours." };
  }

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const bad = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].filter(Boolean);
    return { error: `Please check the shift details${bad.length ? `: ${bad.join(", ")}` : ""}.` };
  }
  const f = parsed.data;

  const project = await prisma.project.findUnique({ where: { id: f.projectId }, select: { id: true, location: true } });
  if (!project) return { error: "That event no longer exists." };

  const { startAt, endAt } = buildShiftRange(f.eventDate, f.startTime, f.endTime);
  const eventDate = new Date(`${f.eventDate}T00:00:00.000Z`);

  // The 4-digit number printed on the venue's timesheet. Blank clears it.
  const tsRaw = (f.timesheetNo ?? "").replace(/\D/g, "");
  if (tsRaw && (tsRaw.length > 4 || Number(tsRaw) === 0)) return { error: "Timesheet No. is up to 4 digits." };
  const timesheetNo = tsRaw ? Number(tsRaw) : null;

  // Moving a shift must not double-book the person.
  const clash = await prisma.deployment.findFirst({
    where: {
      id: { not: id },
      staffId: d.staffId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, project: { select: { name: true, client: { select: { name: true } } } } },
  });
  if (clash) {
    return { error: `That clashes with shift #${clash.id} (${clash.project.client.name} — ${clash.project.name}). Pick another time.` };
  }

  const after = {
    projectId: project.id,
    eventDate,
    startAt,
    endAt,
    breakMinutes: f.breakMinutes,
    location: (f.location || "").toUpperCase() || null,
    shift: f.shift ? f.shift.toUpperCase() : null,
    duty: f.duty || null,
    category: f.category ? f.category.toUpperCase() : d.category,
    timesheetNo,
    notes: f.notes || null,
  };
  const changes = diff(d as unknown as Record<string, unknown>, after);
  if (!changes.length) return { ok: "No changes." };

  const wasApproved = d.status === "APPROVED";
  await prisma.$transaction(async (tx) => {
    await tx.deployment.update({
      where: { id },
      data: {
        ...(after as Prisma.DeploymentUncheckedUpdateInput),
        updatedById: me.id,
        ...(wasApproved
          ? { status: "TIMESHEET_SUBMITTED", approvedById: null, approvedAt: null, verifiedById: null, verifiedAt: null }
          : {}),
      },
    });
    await audit(tx, id, me.id, wasApproved ? "edited-after-approval" : "shift-edited", changes);
    if (wasApproved) await audit(tx, id, me.id, "reopened");
  });

  revalidateAll();
  revalidatePath(`/deployments/${id}`);
  return {
    ok: wasApproved
      ? "Saved. Because this was already approved it has been reopened and needs re-approval."
      : "Shift updated.",
  };
}

// ── Enter actuals ───────────────────────────────────────────────────────────

const timesheetSchema = z.object({
  actualIn: z.string().optional(),
  actualOut: z.string().optional(),
  actualBreakMinutes: z.coerce.number().int().min(0).max(600).optional(),
  noShow: z.string().optional(),
  replacementStaffId: z.string().optional(),
  notes: z.string().optional(),
});

export type EntryState = { ok?: string; error?: string };

export async function saveTimesheet(id: number, _prev: EntryState, formData: FormData): Promise<EntryState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canEnterTimesheet(me.a)) return { error: "You do not have permission to enter timesheets." };

  const d = await prisma.deployment.findUnique({ where: { id } });
  if (!d) return { error: "Deployment not found." };
  if (d.status === "CANCELLED") return { error: "This deployment was cancelled." };
  if (d.status === "APPROVED" && !canEditApproved(me.a)) {
    return { error: "This is approved. Only HR/Admin can change approved hours." };
  }

  const parsed = timesheetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const bad = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].filter(Boolean);
    return { error: `Please check the times${bad.length ? `: ${bad.join(", ")}` : ""}.` };
  }
  const f = parsed.data;

  const noShow = f.noShow === "on" || f.noShow === "true";
  const dayISO = d.eventDate.toISOString().slice(0, 10);
  // Times are entered as wall-clock against the shift day; an out earlier than the
  // in means the shift ran past midnight.
  let actualIn: Date | null = null;
  let actualOut: Date | null = null;
  if (!noShow && f.actualIn && f.actualOut) {
    const r = buildShiftRange(dayISO, f.actualIn, f.actualOut);
    actualIn = r.startAt;
    actualOut = r.endAt;
  }

  const replacementRaw = f.replacementStaffId ? Number(f.replacementStaffId) : null;
  const replacementStaffId = Number.isInteger(replacementRaw) && replacementRaw! > 0 ? replacementRaw : null;
  if (replacementStaffId && replacementStaffId === d.staffId) {
    return { error: "The replacement cannot be the same person." };
  }

  const after: Record<string, unknown> = {
    actualIn,
    actualOut,
    actualBreakMinutes: noShow ? null : (f.actualBreakMinutes ?? 0),
    noShow,
    replacementStaffId,
    notes: f.notes || null,
  };
  const changes = diff(d as unknown as Record<string, unknown>, after);
  if (!changes.length) return { ok: "No changes." };

  // Entering actuals moves the row forward; changing approved figures sends it back.
  const wasApproved = d.status === "APPROVED";
  const status: DeploymentStatus = wasApproved
    ? "TIMESHEET_SUBMITTED"
    : isAtOrAfter(d.status, "TIMESHEET_SUBMITTED")
      ? d.status
      : (actualIn || noShow) ? "TIMESHEET_SUBMITTED" : d.status;

  await prisma.$transaction(async (tx) => {
    await tx.deployment.update({
      where: { id },
      data: {
        ...(after as Prisma.DeploymentUncheckedUpdateInput),
        status,
        updatedById: me.id,
        submittedAt: status === "TIMESHEET_SUBMITTED" ? new Date() : d.submittedAt,
        ...(wasApproved
          ? { approvedById: null, approvedAt: null, verifiedById: null, verifiedAt: null }
          : {}),
      },
    });
    await audit(tx, id, me.id, wasApproved ? "edited-after-approval" : "timesheet", changes);
    if (wasApproved) await audit(tx, id, me.id, "reopened");
  });

  revalidateAll();
  revalidatePath(`/deployments/${id}`);
  return {
    ok: wasApproved
      ? "Saved. Because this was already approved it has been reopened and needs re-approval."
      : "Timesheet saved.",
  };
}

// ── Workflow transitions ────────────────────────────────────────────────────

export type BulkState = { ok?: string; error?: string };

async function transition(ids: number[], to: DeploymentStatus, action: string, verb: string): Promise<BulkState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };

  const allowed =
    to === "DEPLOYED" ? canEnterTimesheet(me.a)
      : to === "TIMESHEET_VERIFIED" ? canVerify(me.a)
        : to === "APPROVED" ? canApprove(me.a)
          : canSchedule(me.a);
  if (!allowed) return { error: `You do not have permission to ${verb} this.` };

  const targets = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!targets.length) return { error: "Nothing selected." };

  const rows = await prisma.deployment.findMany({
    where: { id: { in: targets } },
    select: { id: true, status: true },
  });

  const skipped: string[] = [];
  const ok: number[] = [];
  for (const r of rows) {
    if (r.status === "CANCELLED") { skipped.push(`#${r.id} cancelled`); continue; }
    // Approving without a verified timesheet would put unchecked numbers into payroll.
    if (to === "APPROVED" && !isAtOrAfter(r.status, "TIMESHEET_VERIFIED")) {
      skipped.push(`#${r.id} not verified yet`); continue;
    }
    if (to === "TIMESHEET_VERIFIED" && !isAtOrAfter(r.status, "TIMESHEET_SUBMITTED")) {
      skipped.push(`#${r.id} has no timesheet`); continue;
    }
    ok.push(r.id);
  }
  if (!ok.length) return { error: `Nothing eligible. ${skipped.slice(0, 4).join("; ")}` };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.deployment.updateMany({
      where: { id: { in: ok } },
      data: {
        status: to,
        updatedById: me.id,
        ...(to === "TIMESHEET_VERIFIED" ? { verifiedById: me.id, verifiedAt: now } : {}),
        ...(to === "APPROVED" ? { approvedById: me.id, approvedAt: now } : {}),
      },
    });
    for (const id of ok) await audit(tx, id, me.id, action);
  });

  revalidateAll();
  for (const id of ok) revalidatePath(`/deployments/${id}`);
  return {
    ok: `${action} ${ok.length} deployment${ok.length === 1 ? "" : "s"}.${skipped.length ? ` Skipped ${skipped.length}.` : ""}`,
  };
}

// Declared as async functions, not arrow consts: every export of a "use server"
// module has to be an async function or the build rejects the file.
export async function markDeployed(ids: number[]): Promise<BulkState> {
  return transition(ids, "DEPLOYED", "deployed", "mark this deployed");
}

export async function verifyTimesheets(ids: number[]): Promise<BulkState> {
  return transition(ids, "TIMESHEET_VERIFIED", "verified", "verify");
}

export async function approveDeployments(ids: number[]): Promise<BulkState> {
  return transition(ids, "APPROVED", "approved", "approve");
}

export async function cancelDeployments(ids: number[]): Promise<BulkState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canSchedule(me.a)) return { error: "You do not have permission to cancel." };
  const targets = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!targets.length) return { error: "Nothing selected." };

  const rows = await prisma.deployment.findMany({
    where: { id: { in: targets } },
    select: { id: true, status: true },
  });
  const locked = rows.filter((r) => r.status === "APPROVED");
  if (locked.length && !canEditApproved(me.a)) {
    return { error: `${locked.length} of these are approved — only HR/Admin can cancel those.` };
  }
  await prisma.$transaction(async (tx) => {
    await tx.deployment.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "CANCELLED", updatedById: me.id },
    });
    for (const r of rows) await audit(tx, r.id, me.id, "cancelled");
  });
  revalidateAll();
  return { ok: `Cancelled ${rows.length} deployment${rows.length === 1 ? "" : "s"}.` };
}

/**
 * Remove a shift entirely, for one entered by mistake. Anyone who can schedule may
 * delete a shift that has not been approved; an approved one is payroll history, so
 * only HR/Admin can. Cancelling is usually the better move — it keeps the record and
 * drops out of every report — so the screens offer both.
 */
async function removeShift(id: number): Promise<BulkState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  const d = await prisma.deployment.findUnique({ where: { id }, select: { status: true } });
  if (!d) return { error: "This shift no longer exists." };

  const allowed = d.status === "APPROVED" ? canEditApproved(me.a) : canSchedule(me.a);
  if (!allowed) {
    return { error: d.status === "APPROVED"
      ? "This is approved — only HR/Admin can delete it."
      : "You do not have permission to delete a shift." };
  }

  await prisma.deployment.delete({ where: { id } });
  revalidateAll();
  return { ok: "Shift deleted." };
}

/** Delete from the shift's own page, which then has nothing left to show. */
export async function deleteDeployment(id: number): Promise<BulkState> {
  const res = await removeShift(id);
  if (res.error) return res;
  redirect("/deployments");
}

/**
 * Delete from the scheduling screen, which stays where it is — you are usually part
 * way through rostering an event and sending the whole page to the list would lose
 * the selection you were working on.
 */
export async function deleteScheduledShift(id: number): Promise<BulkState> {
  return removeShift(id);
}

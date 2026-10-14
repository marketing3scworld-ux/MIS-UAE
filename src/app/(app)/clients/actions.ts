"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule } from "@/lib/deployment";

// Clients and their projects/events. Owned by whoever schedules staff, not by
// Settings — the person who needs to add "Mandarin Oriental — NYE Gala" at 5pm on a
// Friday is the same person building the roster.

async function guard(): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { role: true, isOperationsHead: true },
  });
  return !!me && canSchedule({ role: me.role, isOperationsHead: me.isOperationsHead });
}

export type ClientState = { ok?: string; error?: string };

export async function createClient(_prev: ClientState, formData: FormData): Promise<ClientState> {
  if (!(await guard())) return { error: "You do not have permission to add clients." };
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!name) return { error: "Enter a client name." };
  try {
    await prisma.client.upsert({
      where: { name },
      update: { active: true },
      create: { name },
    });
  } catch {
    return { error: "That client already exists." };
  }
  revalidatePath("/deployments");
  revalidatePath("/clients");
  return { ok: `Client "${name}" saved.` };
}

export async function createProject(_prev: ClientState, formData: FormData): Promise<ClientState> {
  if (!(await guard())) return { error: "You do not have permission to add events." };
  const clientId = Number(formData.get("clientId"));
  const typed = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const location = String(formData.get("location") ?? "").trim().toUpperCase();
  if (!Number.isInteger(clientId) || clientId <= 0) return { error: "Pick a client." };

  // The event name is optional. A client who simply supplies staff day to day has no
  // "NYE Gala" to name, so an empty name files the work under the client's own name.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) return { error: "That client no longer exists." };
  const name = typed || client.name;
  try {
    await prisma.project.upsert({
      where: { clientId_name: { clientId, name } },
      update: { active: true, location: location || null },
      create: { clientId, name, location: location || null },
    });
  } catch {
    return { error: "Could not save that event." };
  }
  revalidatePath("/deployments");
  revalidatePath("/clients");
  return { ok: `Event "${name}" saved.` };
}

/** Correct a client's name. Everything scheduled under it follows the rename. */
export async function renameClient(id: number, formData: FormData): Promise<void> {
  if (!(await guard())) return;
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!name) return;
  try {
    await prisma.client.update({ where: { id }, data: { name } });
  } catch {
    return; // a client of that name already exists
  }
  revalidatePath("/clients");
  revalidatePath("/deployments");
}

/** Correct an event's name or its default location. */
export async function renameProject(id: number, formData: FormData): Promise<void> {
  if (!(await guard())) return;
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const location = String(formData.get("location") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!name) return;
  try {
    await prisma.project.update({ where: { id }, data: { name, location: location || null } });
  } catch {
    return; // that client already has an event with this name
  }
  revalidatePath("/clients");
  revalidatePath("/deployments");
}

/**
 * Delete a client or an event outright — for one added by mistake. Anything with
 * shifts recorded against it cannot be deleted; disable it instead, which keeps the
 * history and takes it off the scheduling form.
 */
export async function deleteProject(id: number): Promise<ClientState> {
  if (!(await guard())) return { error: "You do not have permission to delete events." };
  const count = await prisma.deployment.count({ where: { projectId: id } });
  if (count) return { error: `That event has ${count} shift${count === 1 ? "" : "s"} recorded — disable it instead.` };
  await prisma.project.delete({ where: { id } });
  revalidatePath("/clients");
  revalidatePath("/deployments");
  return { ok: "Event deleted." };
}

export async function deleteClient(id: number): Promise<ClientState> {
  if (!(await guard())) return { error: "You do not have permission to delete clients." };
  const count = await prisma.deployment.count({ where: { project: { clientId: id } } });
  if (count) return { error: `That client has ${count} shift${count === 1 ? "" : "s"} recorded — disable it instead.` };
  await prisma.project.deleteMany({ where: { clientId: id } });
  await prisma.client.delete({ where: { id } });
  revalidatePath("/clients");
  revalidatePath("/deployments");
  return { ok: "Client deleted." };
}

export async function toggleClient(id: number, active: boolean): Promise<void> {
  if (!(await guard())) return;
  await prisma.client.update({ where: { id }, data: { active } });
  revalidatePath("/clients");
}

export async function toggleProject(id: number, active: boolean): Promise<void> {
  if (!(await guard())) return;
  await prisma.project.update({ where: { id }, data: { active } });
  revalidatePath("/clients");
}

"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { runExpiryScan } from "@/lib/notifications";

// Mark every unviewed alert for the current user as viewed (§8 "viewing").
export async function markAllRead(): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  // Admin/Ops clear all; Data-Entry clear only their own.
  const scope = can(session.user.role, "staff:viewAll") ? {} : { recipientId: Number(session.user.id) };
  await prisma.notification.updateMany({
    where: { ...scope, state: "UNVIEWED" },
    data: { state: "VIEWED" },
  });
  revalidatePath("/notifications");
  revalidatePath("/", "layout"); // refresh the nav / topbar unread badge
}

// Resolve one alert (recipient-owned) — e.g. handled outside the system.
export async function resolveNotification(id: number): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  // Admin/Ops can resolve any alert; Data-Entry only their own.
  const scope = can(session.user.role, "staff:viewAll") ? {} : { recipientId: Number(session.user.id) };
  await prisma.notification.updateMany({
    where: { id, ...scope, state: { not: "RESOLVED" } },
    data: { state: "RESOLVED", resolvedAt: new Date() },
  });
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

// Manual trigger of the nightly scan — admins only (for testing / catch-up).
export async function runScanNow(): Promise<void> {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "settings:manage")) return;
  await runExpiryScan();
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

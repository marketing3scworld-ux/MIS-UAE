"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { storage } from "@/lib/storage";

// Bulk-delete staff profiles selected with the tick boxes on the Staff list.
// Same rules as the single-profile delete on a staff page: `staff:delete` (System
// Admin only), files come off disk first, then the rows — StaffDocument and
// Notification cascade via the schema's onDelete: Cascade. There is no undo.
export type BulkDeleteState = { ok?: string; error?: string };

export async function bulkDeleteStaff(ids: number[]): Promise<BulkDeleteState> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." };
  if (!can(session.user.role, "staff:delete")) {
    return { error: "Only a System Admin can delete staff profiles." };
  }

  const targets = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!targets.length) return { error: "Nothing selected." };

  const rows = await prisma.staff.findMany({
    where: { id: { in: targets } },
    select: { id: true, documents: { select: { filePath: true } } },
  });
  if (!rows.length) return { error: "Those profiles no longer exist." };

  // Files first. A failure here (already-gone file, permissions) must not block the
  // record delete, or the profile becomes undeletable.
  for (const s of rows) {
    for (const d of s.documents) {
      try {
        await storage.delete(d.filePath);
      } catch (e) {
        console.error(`[staff:bulkDelete] could not remove ${d.filePath}:`, e);
      }
    }
  }

  const res = await prisma.staff.deleteMany({ where: { id: { in: rows.map((s) => s.id) } } });
  console.log(`[staff:bulkDelete] ${res.count} profile(s) removed by ${session.user.email}: #${rows.map((s) => s.id).join(", #")}`);

  revalidatePath("/staff");
  revalidatePath("/documents");
  revalidatePath("/dashboard");
  return { ok: `Deleted ${res.count} profile${res.count === 1 ? "" : "s"}.` };
}

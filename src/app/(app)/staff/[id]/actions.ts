"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { Gender } from "@prisma/client";

const optStr = z
  .string()
  .optional()
  .transform((v) => {
    const s = v?.trim();
    return s ? s : null;
  });

const optDate = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const [y, m, d] = v.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  });

const schema = z.object({
  fullName: z.string().min(1),
  arabicName: optStr,
  eidNumber: optStr, // nullable — attendance-sourced records may have no EID yet
  category: optStr,
  mobileNumber: optStr,
  eidExpiry: optDate,
  ohcExpiry: optDate,
  bfhcExpiry: optDate,
  passportNumber: optStr,
  passportExpiry: optDate,
  visaExpiry: optDate,
  gender: z.string().optional(),
  nationality: optStr,
  location: optStr,
  residenceLocation: optStr,
  employmentStatus: z.string().optional(),
  bankAccountTitle: optStr,
  iban: optStr,
  bankName: optStr,
});

export type UpdateState = { ok?: boolean; error?: string; warning?: string };

export async function updateStaff(
  id: number,
  _prev: UpdateState,
  formData: FormData,
): Promise<UpdateState> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." };
  const role = session.user.role;
  const userId = Number(session.user.id);

  const staff = await prisma.staff.findUnique({ where: { id } });
  if (!staff) return { error: "Staff not found." };

  const canEditProfile =
    can(role, "staff:editAll") ||
    (role === "DATA_ENTRY" && staff.approvalStatus === "PENDING" && staff.createdById === userId);
  const canEditBank = can(role, "staff:editBank");
  if (!canEditProfile && !canEditBank) {
    return { error: "You don't have permission to edit this record." };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the form values." };
  const f = parsed.data;

  const data: Record<string, unknown> = { updatedById: userId };

  if (canEditProfile) {
    const eid = f.eidNumber; // string | null (optStr trims and nulls empties)
    if (eid) {
      const dup = await prisma.staff.findFirst({
        where: { eidNumber: eid, NOT: { id } },
        select: { id: true },
      });
      if (dup) return { error: `EID ${eid} already belongs to staff #${dup.id}.` };
    }

    Object.assign(data, {
      fullName: f.fullName.replace(/\s+/g, " ").trim().toUpperCase(),
      arabicName: f.arabicName,
      eidNumber: eid,
      eidDigits: eid ? eid.replace(/\D/g, "") : null,
      category: f.category?.toUpperCase() ?? null,
      mobileNumber: f.mobileNumber,
      eidExpiry: f.eidExpiry,
      ohcExpiry: f.ohcExpiry,
      bfhcExpiry: f.bfhcExpiry,
      passportNumber: f.passportNumber,
      passportExpiry: f.passportExpiry,
      visaExpiry: f.visaExpiry,
      gender: f.gender === "MALE" ? Gender.MALE : f.gender === "FEMALE" ? Gender.FEMALE : null,
      nationality: f.nationality?.toUpperCase() ?? null,
      location: f.location?.toUpperCase() ?? null,
      residenceLocation: f.residenceLocation?.toUpperCase() ?? null,
      // employmentStatus is deliberately NOT written here. Active/Inactive is derived
      // from document expiry (staff-query.ts activeWhere) and shown read-only on the
      // form, so a save must not overwrite the stored column — which still gates the
      // nightly expiry scan in notifications.ts.
    });
  }

  let warning: string | undefined;
  if (canEditBank) {
    const iban = f.iban ? f.iban.replace(/\s+/g, "").toUpperCase() : null;
    Object.assign(data, {
      bankAccountTitle: f.bankAccountTitle,
      iban,
      bankName: f.bankName?.toUpperCase() ?? null,
    });
    if (iban && !/^AE\d{21}$/.test(iban)) warning = "IBAN saved, but it isn't in AE + 21-digit format.";
  }

  await prisma.staff.update({ where: { id }, data });
  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
  return { ok: true, warning };
}

/**
 * Admin override of the Active/Inactive status. Normally the status follows the
 * documents; this lets HR keep someone active through a renewal, or stand someone
 * down while their papers are still in date. "AUTO" hands control back to the
 * documents. The stored employmentStatus column moves with it, so the nightly expiry
 * scan stops alerting on someone who has been deactivated on purpose.
 */
export async function setStaffStatus(id: number, formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "staff:editAll")) return;
  const choice = String(formData.get("status") ?? "");
  if (!["ACTIVE", "INACTIVE", "AUTO"].includes(choice)) return;
  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;

  await prisma.staff.update({
    where: { id },
    data: choice === "AUTO"
      ? { statusOverride: null, statusNote: null, updatedById: Number(session.user.id) }
      : {
          statusOverride: choice as "ACTIVE" | "INACTIVE",
          employmentStatus: choice as "ACTIVE" | "INACTIVE",
          statusNote: note,
          updatedById: Number(session.user.id),
        },
  });
  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
  revalidatePath("/dashboard");
}

export async function approveStaff(id: number): Promise<void> {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "staff:approve")) return;
  await prisma.staff.update({
    where: { id },
    data: { approvalStatus: "APPROVED", updatedById: Number(session.user.id) },
  });
  revalidatePath(`/staff/${id}`);
}

// Permanently remove a staff profile: every uploaded file on disk, then the row
// itself (StaffDocument + Notification cascade via the schema's onDelete: Cascade).
// There is no undo, so this needs `staff:delete` — System Admin only by default.
//
// If you only want the person to stop generating alerts, set employmentStatus to
// Inactive on the edit form instead; that keeps the documents and the history.
export type DeleteStaffState = { error?: string };

export async function deleteStaff(
  id: number,
  _prev: DeleteStaffState,
  formData: FormData,
): Promise<DeleteStaffState> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." };
  if (!can(session.user.role, "staff:delete")) {
    return { error: "Only a System Admin can delete a staff profile." };
  }

  const staff = await prisma.staff.findUnique({
    where: { id },
    select: { id: true, fullName: true, documents: { select: { filePath: true } } },
  });
  if (!staff) return { error: "Staff not found." };

  // Typed-confirmation guard: the staff number has to be entered by hand, so a
  // stray click on a row can't wipe a profile.
  if (String(formData.get("confirmId") ?? "").trim() !== String(id)) {
    return { error: `Type ${id} to confirm deletion.` };
  }

  // Files first. A failure here (already-removed file, permissions) must not block
  // the record delete, or the profile becomes undeletable.
  for (const d of staff.documents) {
    try {
      await storage.delete(d.filePath);
    } catch (e) {
      console.error(`[staff:delete] could not remove ${d.filePath}:`, e);
    }
  }

  await prisma.staff.delete({ where: { id } });
  console.log(`[staff:delete] #${id} ${staff.fullName} removed by ${session.user.email}`);

  revalidatePath("/staff");
  revalidatePath("/documents");
  revalidatePath("/dashboard");
  redirect("/staff");
}

// Blacklist / un-blacklist a staff member (fraud, misconduct). Restricted to
// full editors (Operations / HR / System Admin), not Data-Entry.
export async function setBlacklist(id: number, formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "staff:editAll")) return;
  const on = String(formData.get("blacklisted")) === "1";
  const reason = String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim();
  await prisma.staff.update({
    where: { id },
    data: {
      blacklisted: on,
      blacklistReason: on ? (reason || null) : null,
      updatedById: Number(session.user.id),
    },
  });
  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
}

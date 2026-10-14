"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { DOC_TYPE_META } from "@/lib/documents";
import { optimizeDocument } from "@/lib/optimize";
import { DocumentType, DocHandlingStatus, type Prisma } from "@prisma/client";

export type DocActionState = { ok?: boolean; error?: string };

const HANDLING = ["WITH_EMPLOYEE", "WITH_HR", "SUBMITTED"];

export async function uploadDocument(
  staffId: number,
  _prev: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." };
  const role = session.user.role;
  const userId = Number(session.user.id);

  const typeRaw = String(formData.get("type") || "");
  if (!(typeRaw in DOC_TYPE_META)) return { error: "Invalid document type." };
  const type = typeRaw as DocumentType;

  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) return { error: "Staff not found." };

  const canProfile =
    can(role, "staff:editAll") ||
    (role === "DATA_ENTRY" && staff.approvalStatus === "PENDING" && staff.createdById === userId);
  const allowed = type === "BANK_PROOF" ? canProfile || can(role, "staff:editBank") : canProfile;
  if (!allowed) return { error: "You don't have permission to upload this document." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file." };

  const raw = Buffer.from(await file.arrayBuffer());
  const opt = await optimizeDocument(raw, file.type || "", file.name);
  const stored = await storage.save(opt.buffer, { staffId, type, ext: opt.ext });

  const expStr = String(formData.get("expiryDate") || "");
  let expiry: Date | null = null;
  if (expStr) {
    const [y, m, d] = expStr.split("-").map(Number);
    if (y && m && d) expiry = new Date(Date.UTC(y, m - 1, d));
  }
  const sRaw = String(formData.get("handlingStatus") || "SUBMITTED");
  const handlingStatus = (HANDLING.includes(sRaw) ? sRaw : "SUBMITTED") as DocHandlingStatus;

  const supersededPath = await prisma.$transaction(async (tx) => {
    const prev = await tx.staffDocument.findFirst({ where: { staffId, type, isCurrent: true } });
    if (prev) await tx.staffDocument.update({ where: { id: prev.id }, data: { isCurrent: false } });
    await tx.staffDocument.create({
      data: {
        staffId,
        type,
        filePath: stored.relPath,
        fileName: opt.fileName,
        mimeType: opt.mime,
        fileSize: stored.size,
        expiryDate: expiry,
        handlingStatus,
        version: prev ? prev.version + 1 : 1,
        isCurrent: true,
        uploadedById: userId,
      },
    });
    const field = DOC_TYPE_META[type].staffExpiryField;
    if (field && expiry) {
      await tx.staff.update({
        where: { id: staffId },
        data: { [field]: expiry, updatedById: userId } as Prisma.StaffUpdateInput,
      });
    }
    return prev?.filePath ?? null;
  });

  // Free the replaced file's bytes so repeated re-uploads don't accumulate on
  // disk. The version's DB row (who/when) is kept for audit; only the file goes.
  if (supersededPath && supersededPath !== stored.relPath) {
    try { await storage.delete(supersededPath); } catch { /* best-effort */ }
  }

  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff");
  return { ok: true };
}

/** Who may change or remove this document — the same rule that governs uploading one. */
async function canManageDoc(docId: number) {
  const session = await auth();
  if (!session?.user) return null;
  const doc = await prisma.staffDocument.findUnique({
    where: { id: docId },
    include: { staff: { select: { id: true, approvalStatus: true, createdById: true } } },
  });
  if (!doc) return null;
  const role = session.user.role;
  const userId = Number(session.user.id);
  const canProfile =
    can(role, "staff:editAll") ||
    (role === "DATA_ENTRY" && doc.staff.approvalStatus === "PENDING" && doc.staff.createdById === userId);
  const allowed = doc.type === "BANK_PROOF" ? canProfile || can(role, "staff:editBank") : canProfile;
  return allowed ? { doc, userId } : null;
}

/**
 * Edit what was recorded about a document without re-uploading it: its expiry, its
 * handling status and the name it is filed under. The matching profile date moves
 * with the expiry, the same way it does on upload.
 */
export async function updateDocument(docId: number, _prev: DocActionState, formData: FormData): Promise<DocActionState> {
  const ctx = await canManageDoc(docId);
  if (!ctx) return { error: "You don't have permission to change this document." };
  const { doc, userId } = ctx;

  const expStr = String(formData.get("expiryDate") || "");
  let expiry: Date | null = null;
  if (expStr) {
    const [y, m, d] = expStr.split("-").map(Number);
    if (y && m && d) expiry = new Date(Date.UTC(y, m - 1, d));
  }
  const sRaw = String(formData.get("handlingStatus") || doc.handlingStatus);
  const handlingStatus = (HANDLING.includes(sRaw) ? sRaw : doc.handlingStatus) as DocHandlingStatus;
  // Keep the real extension: the stored file has not changed, only its label.
  const typed = String(formData.get("fileName") || "").replace(/[\r\n"\\/]/g, "").trim().slice(0, 120);
  const ext = doc.fileName.includes(".") ? doc.fileName.slice(doc.fileName.lastIndexOf(".")) : "";
  const fileName = typed ? (typed.endsWith(ext) ? typed : typed + ext) : doc.fileName;

  await prisma.$transaction(async (tx) => {
    await tx.staffDocument.update({ where: { id: docId }, data: { expiryDate: expiry, handlingStatus, fileName } });
    const field = DOC_TYPE_META[doc.type].staffExpiryField;
    if (field && doc.isCurrent) {
      await tx.staff.update({
        where: { id: doc.staffId },
        data: { [field]: expiry, updatedById: userId } as Prisma.StaffUpdateInput,
      });
    }
  });

  revalidatePath(`/staff/${doc.staffId}`);
  revalidatePath("/staff");
  return { ok: true };
}

/**
 * Remove a document: the row and its bytes. If an older version of the same slot is
 * on file, that one becomes current again rather than leaving the slot empty — the
 * usual reason for deleting is "the wrong file went up".
 */
export async function deleteDocument(docId: number): Promise<DocActionState> {
  const ctx = await canManageDoc(docId);
  if (!ctx) return { error: "You don't have permission to remove this document." };
  const { doc, userId } = ctx;

  const restored = await prisma.$transaction(async (tx) => {
    await tx.staffDocument.delete({ where: { id: docId } });
    if (!doc.isCurrent) return null;
    const previous = await tx.staffDocument.findFirst({
      where: { staffId: doc.staffId, type: doc.type },
      orderBy: { version: "desc" },
    });
    if (previous) await tx.staffDocument.update({ where: { id: previous.id }, data: { isCurrent: true } });

    const field = DOC_TYPE_META[doc.type].staffExpiryField;
    if (field) {
      await tx.staff.update({
        where: { id: doc.staffId },
        data: { [field]: previous?.expiryDate ?? null, updatedById: userId } as Prisma.StaffUpdateInput,
      });
    }
    return previous;
  });

  if (!restored || restored.filePath !== doc.filePath) {
    try { await storage.delete(doc.filePath); } catch { /* already gone */ }
  }

  revalidatePath(`/staff/${doc.staffId}`);
  revalidatePath("/staff");
  return { ok: true };
}

export async function setDocHandlingStatus(docId: number, status: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  if (!HANDLING.includes(status)) return;
  if (!can(session.user.role, "staff:editAll") && !can(session.user.role, "staff:editBank")) return;
  const doc = await prisma.staffDocument.findUnique({ where: { id: docId } });
  if (!doc) return;
  await prisma.staffDocument.update({
    where: { id: docId },
    data: { handlingStatus: status as DocHandlingStatus },
  });
  revalidatePath(`/staff/${doc.staffId}`);
}

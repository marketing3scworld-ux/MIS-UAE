"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { DOC_SLOTS } from "@/lib/documents";
import { optimizeDocument } from "@/lib/optimize";
import { extractEidFields, type EidExtractResult } from "@/lib/eid-ocr";
import { Gender, DocumentType } from "@prisma/client";

// ── Step 1: EID auto-fill (Claude vision) ────────────────────────────────────
// Called directly from the wizard with the EID-front image. Returns the parsed
// fields, or a typed failure so the client can fall back to manual entry.
export async function analyzeEid(formData: FormData): Promise<EidExtractResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "Not authenticated." };
  if (!can(session.user.role, "staff:create")) {
    return { ok: false, reason: "You don't have permission to create profiles." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "Please choose an EID front image first." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractEidFields(buffer, file.type || "");
}

// ── Final save: create the Staff record + attach the uploaded documents ──────
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
  eidNumber: z.string().min(1),
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
  bankAccountTitle: optStr,
  iban: optStr,
  bankName: optStr,
});

export type CreateState = { error?: string };

export async function createStaffWithDocs(formData: FormData): Promise<CreateState> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." };
  const role = session.user.role;
  const userId = Number(session.user.id);
  if (!can(role, "staff:create")) {
    return { error: "You don't have permission to create profiles." };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Full name and EID number are required." };
  const f = parsed.data;

  const eid = f.eidNumber.replace(/\s+/g, " ").trim();
  const dup = await prisma.staff.findFirst({ where: { eidNumber: eid }, select: { id: true } });
  if (dup) return { error: `EID ${eid} already belongs to staff #${dup.id}.` };

  // §8.4: Save → Active. Data-Entry creates PENDING (needs approval); roles with
  // approve rights create APPROVED.
  const approvalStatus = can(role, "staff:approve") ? "APPROVED" : "PENDING";
  const iban = f.iban ? f.iban.replace(/\s+/g, "").toUpperCase() : null;

  // Per-slot expiry mirrors the verified profile fields (single source of truth).
  const expiryFor = (type: DocumentType): Date | null => {
    switch (type) {
      case "EID_FRONT":
      case "EID_BACK":
        return f.eidExpiry;
      case "PASSPORT":
        return f.passportExpiry;
      case "VISA":
        return f.visaExpiry;
      case "OHC":
        return f.ohcExpiry;
      case "BFHC":
        return f.bfhcExpiry;
      default:
        return null;
    }
  };

  let newId: number;
  try {
    const staff = await prisma.staff.create({
      data: {
        fullName: f.fullName.replace(/\s+/g, " ").trim().toUpperCase(),
        arabicName: f.arabicName,
        eidNumber: eid,
        eidDigits: eid.replace(/\D/g, ""),
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
        employmentStatus: "ACTIVE",
        bankAccountTitle: f.bankAccountTitle,
        iban,
        bankName: f.bankName?.toUpperCase() ?? null,
        approvalStatus,
        createdById: userId,
        updatedById: userId,
      },
      select: { id: true },
    });
    newId = staff.id;

    for (const type of DOC_SLOTS) {
      const file = formData.get(`file_${type}`);
      if (!(file instanceof File) || file.size === 0) continue;
      const raw = Buffer.from(await file.arrayBuffer());
      const opt = await optimizeDocument(raw, file.type || "", file.name);
      const stored = await storage.save(opt.buffer, { staffId: newId, type, ext: opt.ext });
      await prisma.staffDocument.create({
        data: {
          staffId: newId,
          type,
          filePath: stored.relPath,
          fileName: opt.fileName,
          mimeType: opt.mime,
          fileSize: stored.size,
          expiryDate: expiryFor(type),
          handlingStatus: "SUBMITTED",
          version: 1,
          isCurrent: true,
          uploadedById: userId,
        },
      });
    }
  } catch {
    return { error: "Could not save the profile. Please check the values and try again." };
  }

  revalidatePath("/staff");
  redirect(`/staff/${newId}`);
}

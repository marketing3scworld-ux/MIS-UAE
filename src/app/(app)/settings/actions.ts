"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { sendMail } from "@/lib/mailer";
import { encryptSecret } from "@/lib/secret-box";
import { Role } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "settings:manage")) return null;
  return session;
}

// User management (add / edit / remove) is limited to Super Admins — a per-user
// flag checked against the DB, not just the System Admin role. Regular admins
// reach the rest of Settings but not this.
async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) return null;
  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { isActive: true, isSuperAdmin: true },
  });
  return me?.isActive && me.isSuperAdmin ? session : null;
}

// ── App settings (expiry window, re-notify interval, escalation threshold) ────
const NUM_KEYS = ["expiryWindowDays", "reNotifyIntervalDays", "escalationThresholdCycles"];

export async function saveAppSettings(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  for (const key of NUM_KEYS) {
    const n = Number.parseInt(String(formData.get(key) ?? "").trim(), 10);
    if (Number.isFinite(n) && n >= 0) {
      await prisma.appSetting.upsert({
        where: { key },
        update: { value: String(n) },
        create: { key, value: String(n) },
      });
    }
  }
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

// ── Dropdown option tables ───────────────────────────────────────────────────
export type OptionTable = "category" | "location" | "residence" | "nationality" | "bank";

export async function addOption(table: OptionTable, formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const value = String(formData.get("value") ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!value) return;
  try {
    switch (table) {
      case "category": await prisma.categoryOption.upsert({ where: { value }, update: { active: true }, create: { value } }); break;
      case "location": await prisma.locationOption.upsert({ where: { value }, update: { active: true }, create: { value } }); break;
      case "residence": await prisma.residenceOption.upsert({ where: { value }, update: { active: true }, create: { value } }); break;
      case "nationality": await prisma.nationalityOption.upsert({ where: { value }, update: { active: true }, create: { value } }); break;
      case "bank": await prisma.bankOption.upsert({ where: { value }, update: { active: true }, create: { value } }); break;
    }
  } catch {
    // ignore duplicate/race — upsert already handles the common case
  }
  revalidatePath("/settings");
}

export async function toggleOption(table: OptionTable, id: number, active: boolean): Promise<void> {
  if (!(await requireAdmin())) return;
  switch (table) {
    case "category": await prisma.categoryOption.update({ where: { id }, data: { active } }); break;
    case "location": await prisma.locationOption.update({ where: { id }, data: { active } }); break;
    case "residence": await prisma.residenceOption.update({ where: { id }, data: { active } }); break;
    case "nationality": await prisma.nationalityOption.update({ where: { id }, data: { active } }); break;
    case "bank": await prisma.bankOption.update({ where: { id }, data: { active } }); break;
  }
  revalidatePath("/settings");
}

// ── Test email (verify SMTP config) ─────────────────────────────────────────
export type TestEmailState = { ok?: boolean; error?: string };

export async function sendTestEmail(_prev: TestEmailState, formData: FormData): Promise<TestEmailState> {
  const session = await requireAdmin();
  if (!session) return { error: "Not authorized." };
  const to = String(formData.get("to") ?? "").trim();
  if (!to || !to.includes("@")) return { error: "Enter a valid recipient email address." };

  const by = session.user.name ?? session.user.email ?? "an administrator";
  const byHtml = by.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const res = await sendMail({
    to,
    subject: "[BME MIS] Test email — delivery is working",
    text:
      `This is a test email from BME MIS, sent by ${by}.\n\n` +
      `If you received this, your SMTP settings are correct and document-expiry escalation alerts will be delivered.\n\n` +
      `— BME MIS · Brilliant Minds Events LLC`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f2440">
  <div style="background:#184170;padding:16px 20px;border-radius:8px 8px 0 0">
    <div style="color:#fff;font-weight:700;letter-spacing:.06em;font-size:15px">BME MIS</div>
    <div style="color:#c4d5ec;font-size:12px;margin-top:2px">SMTP Test</div>
  </div>
  <div style="border:1px solid #dde5ef;border-top:none;border-radius:0 0 8px 8px;padding:20px;font-size:14px">
    <p style="margin:0 0 12px">This is a test email from BME MIS, sent by <strong>${byHtml}</strong>.</p>
    <p style="margin:0">If you received this, your SMTP settings are correct and document-expiry <strong>escalation alerts will be delivered</strong>.</p>
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Brilliant Minds Events LLC · Management Information System</p>
  </div>
</div>`,
  });

  if (res.sent) return { ok: true };
  return { error: res.reason ?? "Failed to send. Check the SMTP settings in .env." };
}

// ── Users ────────────────────────────────────────────────────────────────────
export type CreateUserState = { ok?: boolean; error?: string };

export async function createUser(_prev: CreateUserState, formData: FormData): Promise<CreateUserState> {
  if (!(await requireSuperAdmin())) return { error: "Not authorized." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  const role = String(formData.get("role") ?? "");
  const password = String(formData.get("password") ?? "");
  const isOperationsHead = formData.get("isOperationsHead") === "on";

  if (!email || !name || !password) return { error: "Email, name and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!(role in Role)) return { error: "Please choose a valid role." };

  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) return { error: `A user with ${email} already exists.` };

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      name,
      role: role as Role,
      passwordHash,
      // Recoverable copy so Settings can show this password back to a Super Admin.
      passwordEnc: encryptSecret(password),
      isOperationsHead,
    },
  });
  revalidatePath("/settings");
  return { ok: true };
}

// Set (or reset) a user's password. Super Admin only. This is also the only way to
// fill in the recoverable copy for accounts that pre-date the passwordEnc column —
// their original password is a one-way bcrypt hash and cannot be recovered.
export type SetPasswordState = { ok?: string; error?: string };

export async function setUserPassword(
  id: number,
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  if (!(await requireSuperAdmin())) return { error: "Not authorized." };
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  if (!user) return { error: "User not found." };

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(password, 10), passwordEnc: encryptSecret(password) },
  });
  revalidatePath("/settings");
  return { ok: `Password updated for ${user.name}.` };
}

export async function updateUser(id: number, formData: FormData): Promise<void> {
  const session = await requireSuperAdmin();
  if (!session) return;
  const meId = Number(session.user.id);

  const role = String(formData.get("role") ?? "");
  if (!(role in Role)) return;
  const mgrRaw = String(formData.get("managerId") ?? "");
  const managerId = mgrRaw ? Number(mgrRaw) : null;
  if (managerId === id) return; // no self-manager
  const isOperationsHead = formData.get("isOperationsHead") === "on";
  const isSuperAdmin = formData.get("isSuperAdmin") === "on";
  const isActive = formData.get("isActive") === "on";

  // Guard against self-lockout: you can't demote, drop your own Super Admin, or
  // deactivate your own account.
  const safeRole = (id === meId ? "SYSTEM_ADMIN" : role) as Role;
  const safeSuper = id === meId ? true : isSuperAdmin;
  const safeActive = id === meId ? true : isActive;

  await prisma.user.update({
    where: { id },
    data: { role: safeRole, managerId, isOperationsHead, isSuperAdmin: safeSuper, isActive: safeActive },
  });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

// Remove a user account (Super Admin only). FK-safe: notifications reference the
// recipient as required, so clear those first; manager pointers and the staff
// audit columns (createdBy/updatedBy/handledBy, uploadedBy) are optional and
// null out on delete automatically.
export async function deleteUser(id: number): Promise<void> {
  const session = await requireSuperAdmin();
  if (!session) return;
  if (id === Number(session.user.id)) return; // can't remove yourself

  await prisma.notification.deleteMany({ where: { recipientId: id } });
  await prisma.user.updateMany({ where: { managerId: id }, data: { managerId: null } });
  await prisma.user.delete({ where: { id } });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

// ── Bulk actions on the tick-box selection in the Users table ────────────────
export type BulkUserOp = "activate" | "deactivate" | "remove";
export type BulkUserState = { ok?: string; error?: string };

export async function bulkUpdateUsers(
  op: BulkUserOp,
  ids: number[],
): Promise<BulkUserState> {
  const session = await requireSuperAdmin();
  if (!session) return { error: "Not authorized." };

  // Your own account is always dropped from the selection — deactivating or
  // deleting it mid-session would lock you out of Settings entirely.
  const meId = Number(session.user.id);
  const targets = [...new Set(ids)].filter((n) => Number.isInteger(n) && n !== meId);
  if (!targets.length) return { error: "Nothing selected (your own account is never included)." };

  if (op === "remove") {
    await prisma.notification.deleteMany({ where: { recipientId: { in: targets } } });
    await prisma.user.updateMany({ where: { managerId: { in: targets } }, data: { managerId: null } });
    const res = await prisma.user.deleteMany({ where: { id: { in: targets } } });
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: `Removed ${res.count} account${res.count === 1 ? "" : "s"}.` };
  }

  const isActive = op === "activate";
  const res = await prisma.user.updateMany({ where: { id: { in: targets } }, data: { isActive } });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return {
    ok: `${isActive ? "Activated" : "Deactivated"} ${res.count} account${res.count === 1 ? "" : "s"}.`,
  };
}

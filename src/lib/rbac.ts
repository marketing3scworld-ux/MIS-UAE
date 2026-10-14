import type { Role } from "@prisma/client";

// Role-based permissions from spec §9. Enforce server-side (never trust the UI).
export type Permission =
  | "staff:create"
  | "staff:editAll" // edit any field, any time
  | "staff:editPreApproval" // edit only before approval (own entries)
  | "staff:editBank" // edit bank details only (allowed even after approval)
  | "staff:viewAll" // view all staff (vs. own entries only)
  | "staff:approve"
  | "staff:delete" // permanently remove a profile + its uploaded files
  | "docs:download"
  | "settings:manage"
  | "users:manage";

// Org decision: every user is a full operator over staff & documents — view all,
// create, edit, approve, edit bank details, and download. The things gated are the
// Settings area — `settings:manage` (the Settings page) is System-Admin-only, and
// adding/editing/removing user accounts additionally requires the per-user Super
// Admin flag (checked in the Settings actions) — and `staff:delete`, which
// destroys a profile and its uploaded files with no undo. To re-tighten a role
// later, give it a narrower slice of FULL_STAFF instead of the whole set; to let
// HR delete profiles, add "staff:delete" to HR_ADMIN below.
const FULL_STAFF: Permission[] = [
  "staff:create", "staff:editAll", "staff:editPreApproval", "staff:editBank",
  "staff:viewAll", "staff:approve", "docs:download",
];

const MATRIX: Record<Role, Permission[]> = {
  DATA_ENTRY: FULL_STAFF,
  OPERATIONS: FULL_STAFF,
  HR_ADMIN: FULL_STAFF,
  FINANCE: FULL_STAFF,
  SYSTEM_ADMIN: [...FULL_STAFF, "staff:delete", "settings:manage", "users:manage"],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}

// Managing user accounts (add / edit / remove) requires the per-user Super Admin
// flag, not just the System Admin role — enforced server-side against the DB.
// Regular System Admins get the rest of Settings but a read-only user list.

export const ROLE_LABELS: Record<Role, string> = {
  DATA_ENTRY: "Data Entry",
  OPERATIONS: "Operations",
  HR_ADMIN: "HR / Admin",
  FINANCE: "Finance",
  SYSTEM_ADMIN: "System Admin",
};

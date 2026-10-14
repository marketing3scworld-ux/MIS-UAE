"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/rbac";
import { RemoveUserButton } from "./remove-user-button";
import { UserPasswordCell } from "./user-password-cell";
import { bulkUpdateUsers, updateUser, type BulkUserOp } from "./actions";

export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  isOperationsHead: boolean;
  isSuperAdmin: boolean;
  managerId: number | null;
  // Decrypted server-side for Super Admins only; null when not recoverable.
  password: string | null;
};

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const inputCls =
  "rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";

// Super-Admin view of the user list: tick boxes for selecting rows plus the
// per-row editor. Your own account has no tick box — every bulk action would
// either lock you out or be refused server-side anyway.
export function UsersTable({ users, meId }: { users: UserRow[]; meId: number }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const selectable = useMemo(() => users.filter((u) => u.id !== meId).map((u) => u.id), [users, meId]);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable));

  const runBulk = (op: BulkUserOp) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (op === "remove") {
      const names = users.filter((u) => ids.includes(u.id)).map((u) => u.name).join(", ");
      if (!confirm(`Remove ${ids.length} account(s)?\n\n${names}\n\nThis cannot be undone.`)) return;
    }
    setMessage({});
    startTransition(async () => {
      const res = await bulkUpdateUsers(op, ids);
      setMessage(res);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const bulkBtn =
    "rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50";

  return (
    <>
      {/* Bulk action bar — only meaningful once something is ticked. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {selected.size} selected
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!selected.size || pending} onClick={() => runBulk("activate")} className={bulkBtn}>
            Activate
          </button>
          <button type="button" disabled={!selected.size || pending} onClick={() => runBulk("deactivate")} className={bulkBtn}>
            Deactivate
          </button>
          <button
            type="button"
            disabled={!selected.size || pending}
            onClick={() => runBulk("remove")}
            className="rounded border border-status-expired/40 px-3 py-1.5 text-xs font-medium text-status-expired hover:bg-status-expired/10 disabled:opacity-50"
          >
            Remove
          </button>
          {selected.size ? (
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Clear selection
            </button>
          ) : null}
        </div>
        {message.ok ? <span className="text-xs font-medium text-status-valid">{message.ok}</span> : null}
        {message.error ? <span className="text-xs font-medium text-status-expired">{message.error}</span> : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-9 px-2 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label="Select all users"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  disabled={!selectable.length}
                />
              </th>
              {["User", "Password", "Role", "Manager", "Ops Head", "Super Admin", "Active", ""].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === meId;
              const managers = users.filter((m) => m.id !== u.id);
              const checked = selected.has(u.id);
              return (
                <tr
                  key={u.id}
                  className={`border-b border-border align-middle ${checked ? "bg-brand-gold/10" : ""}`}
                >
                  <td className="px-2 py-2">
                    {isMe ? null : (
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`Select ${u.name}`}
                        checked={checked}
                        onChange={() => toggle(u.id)}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-foreground">
                      {u.name}
                      {isMe ? <span className="ml-1 text-[11px] text-muted-foreground">(you)</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-2 py-2">
                    <UserPasswordCell id={u.id} password={u.password} />
                  </td>
                  <td className="px-2 py-2">
                    <select name="role" form={`u${u.id}`} defaultValue={u.role} className={inputCls}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select name="managerId" form={`u${u.id}`} defaultValue={u.managerId ? String(u.managerId) : ""} className={inputCls}>
                      <option value="">— none —</option>
                      {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" name="isOperationsHead" form={`u${u.id}`} defaultChecked={u.isOperationsHead} className="h-4 w-4" />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      name="isSuperAdmin"
                      form={`u${u.id}`}
                      defaultChecked={u.isSuperAdmin}
                      disabled={isMe}
                      title={isMe ? "You can't drop your own Super Admin access" : undefined}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" name="isActive" form={`u${u.id}`} defaultChecked={u.isActive} disabled={isMe} className="h-4 w-4" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <form id={`u${u.id}`} action={updateUser.bind(null, u.id)}>
                        <button type="submit" className="rounded border border-border px-3 py-1 text-xs font-medium hover:bg-secondary">
                          Save
                        </button>
                      </form>
                      {isMe ? null : <RemoveUserButton id={u.id} name={u.name} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

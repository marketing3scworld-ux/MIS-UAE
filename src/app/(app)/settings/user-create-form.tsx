"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Role } from "@prisma/client";
import { createUser, type CreateUserState } from "./actions";

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const inputCls = "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";

export function UserCreateForm({ allowAdmin = true }: { allowAdmin?: boolean }) {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUser, {});
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const roles = allowAdmin ? ROLES : ROLES.filter((r) => r !== "SYSTEM_ADMIN");

  useEffect(() => {
    if (!state.ok) return;
    ref.current?.reset();
    router.refresh(); // so the new account appears in the table below immediately
  }, [state.ok, router]);

  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      <label className="block space-y-1 lg:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Name</span>
        <input name="name" required className={inputCls} />
      </label>
      <label className="block space-y-1 lg:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Email</span>
        <input name="email" type="email" required className={inputCls} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Role</span>
        <select name="role" defaultValue="OPERATIONS" className={inputCls}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Temp password</span>
        <input name="password" type="text" required minLength={8} placeholder="min 8 chars" className={inputCls} />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground lg:col-span-2">
        <input type="checkbox" name="isOperationsHead" className="h-4 w-4" />
        Operations Head (receives document alerts)
      </label>
      <div className="lg:col-span-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Add user"}
        </button>
      </div>
      {state.error ? <p className="text-sm text-status-expired lg:col-span-6">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-status-valid lg:col-span-6">User created.</p> : null}
    </form>
  );
}

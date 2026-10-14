import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";
import { UserCreateForm } from "./user-create-form";
import { UsersTable } from "./users-table";
import { TestEmailButton } from "./test-email-button";
import {
  saveAppSettings, addOption, toggleOption, type OptionTable,
} from "./actions";

export const dynamic = "force-dynamic";

const inputCls = "rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";

export default async function SettingsPage() {
  const session = await auth();
  const meId = Number(session!.user.id);
  const isFullAdmin = can(session!.user.role, "settings:manage");
  // Settings is restricted to System Admins only (spec §9 hardening).
  if (!isFullAdmin) redirect("/dashboard");

  const [settings, cats, locs, residences, nats, banks, users, me] = await Promise.all([
    getSettings(),
    prisma.categoryOption.findMany({ orderBy: { value: "asc" } }),
    prisma.locationOption.findMany({ orderBy: { value: "asc" } }),
    prisma.residenceOption.findMany({ orderBy: [{ sortOrder: "asc" }, { value: "asc" }] }),
    prisma.nationalityOption.findMany({ orderBy: { value: "asc" } }),
    prisma.bankOption.findMany({ orderBy: { value: "asc" } }),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        isOperationsHead: true, isSuperAdmin: true, managerId: true, passwordEnc: true,
      },
    }),
    prisma.user.findUnique({ where: { id: meId }, select: { isSuperAdmin: true } }),
  ]);
  // Only Super Admins may add / edit / remove user accounts. Every System Admin
  // gets the rest of Settings and a read-only view of the user list.
  const isSuper = !!me?.isSuperAdmin;

  // Decrypt the recoverable password copy HERE, for Super Admins only, and hand the
  // client the plaintext instead of the ciphertext — a non-Super-Admin's browser
  // never receives either. `null` means the password isn't recoverable (account
  // pre-dates the column, or NEXTAUTH_SECRET changed since it was written).
  const userRows = users.map(({ passwordEnc, ...u }) => ({
    ...u,
    password: isSuper ? decryptSecret(passwordEnc) : null,
  }));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Engine configuration, dropdown lists, and user accounts.
        </p>
      </div>

      {/* App settings */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Expiry engine</h2>
        <form action={saveAppSettings} className="mt-4 flex flex-wrap items-end gap-4">
          <NumberField name="expiryWindowDays" label="Expiry window (days)" value={settings.expiryWindowDays} hint="“Expiring soon” threshold" />
          <NumberField name="reNotifyIntervalDays" label="Re-notify interval (days)" value={settings.reNotifyIntervalDays} hint="days between repeat alerts" />
          <NumberField name="escalationThresholdCycles" label="Escalate after (cycles)" value={settings.escalationThresholdCycles} hint="unactioned alerts before email escalation" />
          <button type="submit" className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90">
            Save settings
          </button>
        </form>
      </section>

      {/* Email */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Email</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Verify the SMTP settings in <code>.env</code>. Escalation alerts use this configuration.
        </p>
        <div className="mt-4">
          <TestEmailButton defaultTo={session!.user.email ?? ""} />
        </div>
      </section>

      {/* Dropdown options */}
      <section>
        <h2 className="text-sm font-semibold text-foreground">Dropdown lists</h2>
        <p className="mt-1 text-xs text-muted-foreground">Disabled values stay on existing records but drop out of the pickers.</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <OptionsPanel table="category" title="Categories" items={cats} />
          <OptionsPanel table="location" title="Service Locations" items={locs} hint="Work sites" />
          <OptionsPanel table="residence" title="Residence Locations" items={residences} hint="Where staff live" />
          <OptionsPanel table="nationality" title="Nationalities" items={nats} />
          <OptionsPanel table="bank" title="Banks" items={banks} />
        </div>
      </section>

      {/* Users */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Users</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isSuper
            ? "Operations users (or the flagged Operations Head) receive document alerts; escalation emails go to a user's manager. Super Admins can add, edit, and remove accounts. Tick the boxes to act on several at once."
            : "Adding, editing, and removing user accounts is limited to Super Admins. You have read-only access to this list."}
        </p>
        {isSuper ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Passwords set through this page are stored in a recoverable form so they can
            be shown here. Accounts created before this was added — and any password
            changed outside the app — read as <em>not recorded</em>; use the key icon to
            set a new one.
          </p>
        ) : null}

        {isSuper ? (
        <>
        <div className="mt-4">
          <UserCreateForm allowAdmin />
        </div>

        <UsersTable users={userRows} meId={meId} />
        </>
        ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {["User", "Role", "Ops Head", "Super Admin", "Active"].map((h) => (
                  <th key={h} className="px-2 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border">
                  <td className="px-2 py-2">
                    <div className="font-medium text-foreground">
                      {u.name}
                      {u.id === meId ? <span className="ml-1 text-[11px] text-muted-foreground">(you)</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-2 py-2 text-foreground">{ROLE_LABELS[u.role]}</td>
                  <td className="px-2 py-2 text-muted-foreground">{u.isOperationsHead ? "Yes" : "—"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{u.isSuperAdmin ? "Yes" : "—"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{u.isActive ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </div>
  );
}

function NumberField({ name, label, value, hint }: { name: string; label: string; value: number; hint: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="number" name={name} min={0} defaultValue={value} className={`w-40 ${inputCls}`} />
      <span className="block text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}

function OptionsPanel({
  table,
  title,
  items,
  hint,
}: {
  table: OptionTable;
  title: string;
  items: { id: number; value: string; active: boolean }[];
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title} <span className="text-xs font-normal text-muted-foreground">({items.filter((i) => i.active).length})</span></h3>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
        {items.length === 0 ? <li className="text-xs text-muted-foreground">No values yet.</li> : null}
        {items.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
            <span className={o.active ? "text-foreground" : "text-muted-foreground line-through"}>{o.value}</span>
            <form action={toggleOption.bind(null, table, o.id, !o.active)}>
              <button type="submit" className="flex-none rounded border border-border px-2 py-0.5 text-[11px] hover:bg-secondary">
                {o.active ? "Disable" : "Enable"}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addOption.bind(null, table)} className="mt-3 flex gap-2">
        <input name="value" placeholder="Add value…" className="w-full rounded-md border border-input bg-white px-2 py-1 text-sm outline-none focus:border-brand-gold" />
        <button type="submit" className="flex-none rounded-md bg-brand-navy px-3 py-1 text-sm font-medium text-white hover:bg-brand-navy/90">Add</button>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { titleCaseLabel } from "@/lib/format";
import { createClient, createProject, type ClientState } from "./actions";

export function ClientProjectForms({ clients }: { clients: { id: number; name: string }[] }) {
  const router = useRouter();
  const [cState, cAction, cPending] = useActionState<ClientState, FormData>(createClient, {});
  const [pState, pAction, pPending] = useActionState<ClientState, FormData>(createProject, {});
  const cRef = useRef<HTMLFormElement>(null);
  const pRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (cState.ok) { cRef.current?.reset(); router.refresh(); }
  }, [cState.ok, router]);
  useEffect(() => {
    if (pState.ok) { pRef.current?.reset(); router.refresh(); }
  }, [pState.ok, router]);

  const fld = "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";
  const btn = "rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form ref={cRef} action={cAction} className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Add a client</h2>
        <div className="mt-3 flex gap-2">
          <input name="name" required placeholder="e.g. MANDARIN ORIENTAL" className={fld} />
          <button type="submit" disabled={cPending} className={`${btn} flex-none`}>
            {cPending ? "Saving…" : "Add"}
          </button>
        </div>
        {cState.error ? <p className="mt-2 text-xs text-status-expired">{cState.error}</p> : null}
        {cState.ok ? <p className="mt-2 text-xs text-status-valid">{cState.ok}</p> : null}
      </form>

      <form ref={pRef} action={pAction} className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Add an event</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select name="clientId" required defaultValue="" className={fld}>
            <option value="" disabled>Client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{titleCaseLabel(c.name)}</option>)}
          </select>
          <input name="name" placeholder="Event name (optional)" className={fld} />
          <button type="submit" disabled={pPending} className={`${btn} flex-none`}>
            {pPending ? "Saving…" : "Add"}
          </button>
          <input name="location" placeholder="Default location (optional)" className={`${fld} sm:col-span-3`} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          No event name? Leave it blank and the work is filed under the client&apos;s own name.
        </p>
        {pState.error ? <p className="mt-2 text-xs text-status-expired">{pState.error}</p> : null}
        {pState.ok ? <p className="mt-2 text-xs text-status-valid">{pState.ok}</p> : null}
      </form>
    </div>
  );
}

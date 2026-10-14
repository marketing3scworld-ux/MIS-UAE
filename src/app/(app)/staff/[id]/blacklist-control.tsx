"use client";

import { useState } from "react";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { setBlacklist } from "./actions";

// Blacklist banner + admin control. When blacklisted, shows a prominent red
// banner with the reason (and a Remove button for editors). When not, editors
// see a small "Blacklist this staff" trigger that opens a reason box.
export function BlacklistControl({
  staffId,
  blacklisted,
  reason,
  canManage,
}: {
  staffId: number;
  blacklisted: boolean;
  reason: string | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (blacklisted) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-rose-600" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-rose-700">Blacklisted</div>
          <div className={reason ? "mt-0.5 text-sm text-rose-600/90" : "mt-0.5 text-sm text-rose-500/70"}>
            {reason || "No reason recorded."}
          </div>
        </div>
        {canManage ? (
          <form action={setBlacklist.bind(null, staffId)} className="flex-none">
            <input type="hidden" name="blacklisted" value="0" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              <ShieldOff className="h-3.5 w-3.5" /> Remove from blacklist
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  if (!canManage) return null;

  return open ? (
    <form action={setBlacklist.bind(null, staffId)} className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
      <input type="hidden" name="blacklisted" value="1" />
      <div className="text-sm font-medium text-foreground">Blacklist this staff</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Record the reason (fraud, misconduct, …). They&apos;ll be clearly flagged across the app.
      </p>
      <textarea
        name="reason"
        rows={2}
        placeholder="Reason…"
        className="mt-2 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-rose-400"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
        >
          <ShieldAlert className="h-3.5 w-3.5" /> Blacklist
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700"
    >
      <ShieldAlert className="h-3.5 w-3.5" /> Blacklist this staff
    </button>
  );
}

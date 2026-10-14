"use client";

import { useActionState, useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { deleteStaff, type DeleteStaffState } from "./actions";

// Danger zone for a staff profile. Deletion is irreversible and takes the uploaded
// files with it, so the panel stays collapsed until asked for and then requires the
// staff number to be typed — the server re-checks that value, this isn't just UI.
export function DeleteProfile({ staffId, fullName }: { staffId: number; fullName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteStaffState, FormData>(
    deleteStaff.bind(null, staffId),
    {},
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-status-expired/40 px-3 py-2 text-sm font-medium text-status-expired hover:bg-status-expired/10"
      >
        <Trash2 className="h-4 w-4" /> Delete profile
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-status-expired/40 bg-status-expired/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-status-expired" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-status-expired">Delete this profile permanently</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Removes <strong className="text-foreground">{fullName}</strong> (Staff No. {staffId}), every
            uploaded document and file, and all related alerts. This cannot be undone.
            To simply stop alerts, set Employment Status to <em>Inactive</em> instead.
          </p>

          <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="confirmId" className="text-xs text-muted-foreground">
              Type <strong className="text-foreground">{staffId}</strong> to confirm:
            </label>
            <input
              id="confirmId"
              name="confirmId"
              inputMode="numeric"
              autoComplete="off"
              className="w-24 rounded-md border border-input bg-white px-2 py-1.5 text-sm outline-none focus:border-status-expired"
            />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-status-expired px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> {pending ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </form>

          {state.error ? (
            <p className="mt-2 text-xs font-medium text-status-expired">{state.error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

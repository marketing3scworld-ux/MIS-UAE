"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { titleCaseName } from "@/lib/format";
import { saveTimesheet, type EntryState } from "../actions";

export type TimesheetInitial = {
  actualIn: string; // "HH:MM" or ""
  actualOut: string;
  actualBreakMinutes: number;
  noShow: boolean;
  replacementStaffId: string;
  notes: string;
};

/**
 * Actual attendance for one shift. Absent and worked are mutually exclusive, so
 * ticking no-show disables the time inputs rather than letting someone record an
 * absence with hours against it.
 */
export function TimesheetForm({
  deploymentId,
  initial,
  staffOptions,
  readOnly,
  approvedWarning,
}: {
  deploymentId: number;
  initial: TimesheetInitial;
  staffOptions: { id: number; fullName: string }[];
  readOnly: boolean;
  approvedWarning: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<EntryState, FormData>(
    saveTimesheet.bind(null, deploymentId),
    {},
  );
  const [noShow, setNoShow] = useState(initial.noShow);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const fld = "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold disabled:bg-secondary disabled:text-muted-foreground";

  return (
    <form action={action} className="space-y-4">
      {state.error ? <div className="rounded-md bg-status-expired/10 px-3 py-2 text-sm text-status-expired">{state.error}</div> : null}
      {state.ok ? <div className="rounded-md bg-status-valid/10 px-3 py-2 text-sm text-status-valid">{state.ok}</div> : null}
      {approvedWarning ? (
        <div className="rounded-md border border-status-expiring/40 bg-status-expiring/5 px-3 py-2 text-xs text-foreground">
          These hours are <strong>approved</strong> and already available to payroll and invoicing.
          Saving a change records it in the audit trail and sends the row back for re-approval.
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="noShow"
          className="h-4 w-4"
          defaultChecked={initial.noShow}
          disabled={readOnly}
          onChange={(e) => setNoShow(e.target.checked)}
        />
        <span className="font-medium text-foreground">No-show / absent</span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Actual check-in</span>
          <input type="time" name="actualIn" defaultValue={initial.actualIn} disabled={readOnly || noShow} className={fld} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Actual check-out</span>
          <input type="time" name="actualOut" defaultValue={initial.actualOut} disabled={readOnly || noShow} className={fld} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Break taken (min)</span>
          <input type="number" name="actualBreakMinutes" min={0} max={600} defaultValue={initial.actualBreakMinutes} disabled={readOnly || noShow} className={fld} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Replacement staff</span>
          <select name="replacementStaffId" defaultValue={initial.replacementStaffId} disabled={readOnly} className={fld}>
            <option value="">— none —</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>#{s.id} {titleCaseName(s.fullName)}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Notes</span>
        <input name="notes" defaultValue={initial.notes} disabled={readOnly} className={fld} />
      </label>

      {readOnly ? (
        <p className="text-sm text-muted-foreground">You have read-only access to this timesheet.</p>
      ) : (
        <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60">
          <Save className="h-4 w-4" /> {pending ? "Saving…" : "Save timesheet"}
        </button>
      )}
    </form>
  );
}

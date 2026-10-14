"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { titleCaseLabel } from "@/lib/format";
import { updateDeployment, deleteDeployment, type EditState } from "../actions";

export type ShiftValues = {
  projectId: number;
  eventDate: string; // yyyy-mm-dd
  startTime: string; // HH:MM
  endTime: string;
  breakMinutes: number;
  location: string;
  shift: string;
  duty: string;
  category: string;
  timesheetNo: string;
  notes: string;
};

/**
 * Edit a shift that is already on the roster: its date, its times, which client and
 * event it belongs to, the staff category, the venue's timesheet number. Everything
 * entered when the shift was created can be corrected here rather than cancelled and
 * typed again.
 */
export function EditShift({
  deploymentId,
  initial,
  projects,
  shifts,
  locations,
  categories,
  canEdit,
  canDelete,
}: {
  deploymentId: number;
  initial: ShiftValues;
  projects: { id: number; name: string; clientName: string }[];
  shifts: { value: string; startTime: string | null; endTime: string | null }[];
  locations: string[];
  categories: string[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<EditState, FormData>(
    async (prev, fd) => {
      const res = await updateDeployment(deploymentId, prev, fd);
      if (res.ok) router.refresh();
      return res;
    },
    {},
  );
  const [start, setStart] = useState(initial.startTime);
  const [end, setEnd] = useState(initial.endTime);
  const [client, setClient] = useState(
    projects.find((p) => p.id === initial.projectId)?.clientName ?? "",
  );

  const clientNames = [...new Set(projects.map((p) => p.clientName))].sort((a, b) => a.localeCompare(b));
  const events = projects.filter((p) => p.clientName === client);
  const fld = "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";
  const crossesMidnight = end <= start;

  async function remove() {
    if (!confirm("Delete this shift completely? Cancelling keeps the record instead — this does not.")) return;
    const res = await deleteDeployment(deploymentId);
    if (res?.error) alert(res.error);
  }

  if (!canEdit) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit shift
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-status-expired hover:bg-status-expired/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        ) : null}
        {state.ok ? <span className="self-center text-xs text-status-valid">{state.ok}</span> : null}
      </div>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Client</span>
          <select className={fld} value={client} onChange={(e) => setClient(e.target.value)}>
            {clientNames.map((c) => <option key={c} value={c}>{titleCaseLabel(c)}</option>)}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Event</span>
          <select name="projectId" required className={fld} defaultValue={String(initial.projectId)} key={client}>
            {events.map((p) => <option key={p.id} value={p.id}>{titleCaseLabel(p.name)}</option>)}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Event date</span>
          <input type="date" name="eventDate" required defaultValue={initial.eventDate} className={fld} />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Timesheet No.</span>
          <input
            name="timesheetNo"
            inputMode="numeric"
            maxLength={4}
            pattern="\d{0,4}"
            placeholder="e.g. 8302"
            defaultValue={initial.timesheetNo}
            className={fld}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Start</span>
          <input type="time" name="startTime" required value={start} onChange={(e) => setStart(e.target.value)} className={fld} />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">End</span>
          <input type="time" name="endTime" required value={end} onChange={(e) => setEnd(e.target.value)} className={fld} />
          {crossesMidnight ? (
            <span className="block text-[11px] text-status-expiring">Runs past midnight — ends the next day</span>
          ) : null}
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Unpaid break (min)</span>
          <input type="number" name="breakMinutes" min={0} max={600} defaultValue={initial.breakMinutes} className={fld} />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Shift</span>
          <select name="shift" className={fld} defaultValue={initial.shift.toUpperCase()}>
            <option value="">—</option>
            {shifts.map((s) => <option key={s.value} value={s.value}>{titleCaseLabel(s.value)}</option>)}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Location</span>
          <input name="location" list="edit-loc" defaultValue={initial.location} className={fld} />
          <datalist id="edit-loc">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Staff Category</span>
          <input name="duty" list="edit-duty" defaultValue={initial.duty} placeholder="e.g. Waiter, Hostess" className={fld} />
          <datalist id="edit-duty">{categories.map((c) => <option key={c} value={titleCaseLabel(c)} />)}</datalist>
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <input name="notes" defaultValue={initial.notes} className={fld} />
        </label>
      </div>

      {state.error ? <p className="mt-3 text-xs text-status-expired">{state.error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save shift"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
          Cancel
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={remove}
            className="ms-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-status-expired hover:bg-status-expired/10"
          >
            <Trash2 className="h-4 w-4" /> Delete shift
          </button>
        ) : null}
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { titleCaseLabel, titleCaseName } from "@/lib/format";
import { updateDeployment, deleteScheduledShift, type ScheduledShift } from "../actions";

/**
 * The shifts saved on this screen, newest first, each with Edit and Delete.
 *
 * A wrong date or a mistyped time is noticed the second the save lands, and the only
 * way to fix it used to be: leave the page, find the shift on the deployments list,
 * open it, edit it there — losing the half-built roster you were working on. The same
 * correction now happens where the mistake was made.
 */
export function ScheduledList({
  shifts,
  presets,
  locations,
  categories,
  patch,
  remove,
}: {
  shifts: ScheduledShift[];
  presets: { value: string; startTime: string | null; endTime: string | null }[];
  locations: string[];
  categories: string[];
  patch: (id: number, values: Partial<ScheduledShift>) => void;
  remove: (id: number) => void;
}) {
  if (!shifts.length) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Saved on this screen
          <span className="ml-1 font-normal text-muted-foreground">({shifts.length})</span>
        </h2>
        <Link href="/deployments" className="text-xs text-brand-navy hover:underline">
          See every shift →
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Wrong date, wrong times, wrong staff category? Correct it here, or delete the shift and
        schedule it again. Each one is already saved and on the deployments list.
      </p>

      <ul className="mt-3 divide-y divide-border">
        {shifts.map((s) => (
          <Row key={s.id} s={s} presets={presets} locations={locations} categories={categories} patch={patch} remove={remove} />
        ))}
      </ul>
    </section>
  );
}

function Row({
  s,
  presets,
  locations,
  categories,
  patch,
  remove,
}: {
  s: ScheduledShift;
  presets: { value: string; startTime: string | null; endTime: string | null }[];
  locations: string[];
  categories: string[];
  patch: (id: number, values: Partial<ScheduledShift>) => void;
  remove: (id: number) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const save = (fd: FormData) =>
    start(async () => {
      const res = await updateDeployment(s.id, {}, fd);
      if (res.error) { setError(res.error); return; }
      setError("");
      // Keep the row showing what was actually saved, so a second correction starts
      // from the corrected values rather than the original mistake.
      patch(s.id, {
        eventDate: String(fd.get("eventDate") ?? s.eventDate),
        startTime: String(fd.get("startTime") ?? s.startTime),
        endTime: String(fd.get("endTime") ?? s.endTime),
        breakMinutes: Number(fd.get("breakMinutes") ?? s.breakMinutes) || 0,
        location: String(fd.get("location") ?? "").toUpperCase(),
        shift: String(fd.get("shift") ?? ""),
        duty: String(fd.get("duty") ?? ""),
        timesheetNo: String(fd.get("timesheetNo") ?? "").replace(/\D/g, ""),
        notes: String(fd.get("notes") ?? ""),
      });
      setEditing(false);
      router.refresh();
    });

  const drop = () =>
    start(async () => {
      if (!confirm(`Delete ${titleCaseName(s.staffName)}'s shift on ${s.eventDate}? This removes it completely.`)) return;
      const res = await deleteScheduledShift(s.id);
      if (res.error) { setError(res.error); return; }
      remove(s.id);
      router.refresh();
    });

  const fld = "w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-gold";
  const lbl = "block space-y-1";
  const cap = "text-[11px] font-medium text-muted-foreground";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{titleCaseName(s.staffName)}</span>
          <span className="ms-2 text-xs text-muted-foreground">
            {s.eventDate} · {s.startTime}–{s.endTime}
            {s.breakMinutes ? ` · ${s.breakMinutes}m break` : ""} · {titleCaseLabel(s.clientName)}
            {s.projectName !== s.clientName ? ` — ${titleCaseLabel(s.projectName)}` : ""}
            {s.duty ? ` · ${titleCaseLabel(s.duty)}` : ""}
            {s.timesheetNo ? ` · TS ${s.timesheetNo}` : ""}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <Link
            href={`/deployments/${s.id}`}
            title="Open the shift"
            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); setError(""); }}
            title="Edit this shift"
            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-secondary"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={drop}
            disabled={pending}
            title="Delete this shift"
            className="rounded border border-border px-2 py-1 text-[11px] text-status-expired hover:bg-status-expired/10 disabled:opacity-60"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {error ? <p className="mt-1.5 text-xs text-status-expired">{error}</p> : null}

      {editing ? (
        <form action={save} className="mt-3 rounded-lg border border-border p-3">
          {/* The event itself is not changed here — that is a different booking. Use the
              shift's own page to move it to another client or event. */}
          <input type="hidden" name="projectId" value={s.projectId} />
          <input type="hidden" name="category" value={s.category} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className={lbl}>
              <span className={cap}>Event date</span>
              <input type="date" name="eventDate" required defaultValue={s.eventDate} className={fld} />
            </label>
            <label className={lbl}>
              <span className={cap}>Start</span>
              <input type="time" name="startTime" required defaultValue={s.startTime} className={fld} />
            </label>
            <label className={lbl}>
              <span className={cap}>End</span>
              <input type="time" name="endTime" required defaultValue={s.endTime} className={fld} />
            </label>
            <label className={lbl}>
              <span className={cap}>Unpaid break (min)</span>
              <input type="number" name="breakMinutes" min={0} max={600} defaultValue={s.breakMinutes} className={fld} />
            </label>
            <label className={lbl}>
              <span className={cap}>Timesheet No.</span>
              <input name="timesheetNo" inputMode="numeric" maxLength={4} pattern="\d{0,4}" placeholder="e.g. 8302" defaultValue={s.timesheetNo} className={fld} />
            </label>
            <label className={lbl}>
              <span className={cap}>Shift</span>
              <select name="shift" defaultValue={s.shift.toUpperCase()} className={fld}>
                <option value="">—</option>
                {presets.map((p) => <option key={p.value} value={p.value}>{titleCaseLabel(p.value)}</option>)}
              </select>
            </label>
            <label className={lbl}>
              <span className={cap}>Location</span>
              <input name="location" list={`loc-${s.id}`} defaultValue={s.location} className={fld} />
              <datalist id={`loc-${s.id}`}>{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </label>
            <label className={lbl}>
              <span className={cap}>Staff Category</span>
              <input name="duty" list={`duty-${s.id}`} defaultValue={s.duty} placeholder="e.g. Waiter" className={fld} />
              <datalist id={`duty-${s.id}`}>{categories.map((c) => <option key={c} value={titleCaseLabel(c)} />)}</datalist>
            </label>
            <label className={`${lbl} col-span-2 sm:col-span-4`}>
              <span className={cap}>Notes</span>
              <input name="notes" defaultValue={s.notes} className={fld} />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

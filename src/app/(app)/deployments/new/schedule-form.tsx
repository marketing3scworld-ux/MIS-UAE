"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, Search } from "lucide-react";
import { titleCaseLabel, titleCaseName } from "@/lib/format";
import { scheduleStaff, type ScheduleState, type ScheduledShift } from "../actions";
import { ScheduledList } from "./scheduled-list";

export type PickableStaff = {
  id: number;
  fullName: string;
  category: string;
  location: string;
  compliant: boolean; // all documents on file and in date
  issue: string; // why not, when not
};

export type ShiftPreset = { value: string; startTime: string | null; endTime: string | null };

/**
 * Schedule staff for a shift. Deliberately one form: pick the project and shift once,
 * then tick everyone who works it — an event needs twenty people on the same shift,
 * and doing that one row at a time is the thing operations teams abandon.
 *
 * Staff whose documents are expired or missing are shown with a warning rather than
 * hidden: the Phase-1 compliance status is advisory here, and Operations sometimes
 * has to deploy someone whose OHC renewal is in progress.
 */
export function ScheduleForm({
  projects,
  clients,
  staff,
  shifts,
  locations,
  defaultDate,
  preselectProjectId,
  preselectClient,
}: {
  projects: { id: number; name: string; clientName: string; location: string }[];
  clients: string[];
  staff: PickableStaff[];
  shifts: ShiftPreset[];
  locations: string[];
  defaultDate: string;
  preselectProjectId?: string;
  preselectClient?: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ScheduleState, FormData>(scheduleStaff, {});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyCompliant, setOnlyCompliant] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  // With no projects yet, open on the "new project" fields rather than an empty
  // dropdown that leads nowhere.
  const [projectMode, setProjectMode] = useState<string>(
    preselectProjectId ?? (projects.length ? "" : "__new__"),
  );

  // Client first, then that client's events. A single grouped dropdown put the client
  // in an <optgroup>, which cannot be clicked — so picking a client was impossible.
  const clientNames = useMemo(
    () => [...new Set([...projects.map((p) => p.clientName), ...clients])].sort((a, b) => a.localeCompare(b)),
    [projects, clients],
  );
  const [client, setClient] = useState<string>(() => {
    if (preselectClient) return preselectClient;
    const pre = projects.find((p) => String(p.id) === preselectProjectId);
    return pre?.clientName ?? "";
  });
  const clientEvents = useMemo(
    () => projects.filter((p) => p.clientName === client),
    [projects, client],
  );

  const categories = useMemo(
    () => [...new Set(staff.map((s) => s.category).filter(Boolean))].sort(),
    [staff],
  );

  // Everything saved on this screen, so a wrong entry can be corrected here instead of
  // being hunted down on the deployments list. Collected DURING RENDER from the action's
  // result — in an effect it would appear one paint late, after the eye has moved on.
  const [recent, setRecent] = useState<ScheduledShift[]>([]);
  const [lastBatch, setLastBatch] = useState<ScheduledShift[] | undefined>(undefined);
  if (state.created !== lastBatch) {
    setLastBatch(state.created);
    const batch = state.created;
    if (batch?.length) {
      setRecent((prev) => [...batch, ...prev.filter((p) => !batch.some((c) => c.id === p.id))]);
    }
  }
  const patchRecent = (id: number, values: Partial<ScheduledShift>) =>
    setRecent((prev) => prev.map((r) => (r.id === id ? { ...r, ...values } : r)));
  const dropRecent = (id: number) => setRecent((prev) => prev.filter((r) => r.id !== id));

  const visible = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return staff.filter((s) => {
      if (onlyCompliant && !s.compliant) return false;
      if (cat && s.category !== cat) return false;
      if (!needle) return true;
      return s.fullName.toUpperCase().includes(needle) || String(s.id) === needle;
    });
  }, [staff, q, cat, onlyCompliant]);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const applyPreset = (value: string) => {
    const s = shifts.find((x) => x.value === value);
    if (s?.startTime) setStart(s.startTime);
    if (s?.endTime) setEnd(s.endTime);
  };

  const fld = "w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold";
  const crossesMidnight = end <= start;

  return (
    <div className="space-y-5">
      {/* The saved-shift list below carries its own edit forms, so it sits outside this
          one: a form inside a form is invalid HTML and the inner submit never fires. */}
      <form
        action={(fd) => {
          for (const id of picked) fd.append("staffIds", String(id));
          action(fd);
          setPicked(new Set());
          router.refresh();
        }}
        className="space-y-5"
      >
      {state.error ? (
        <div className="rounded-md bg-status-expired/10 px-3 py-2 text-sm text-status-expired">{state.error}</div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md bg-status-valid/10 px-3 py-2 text-sm text-status-valid">{state.ok}</div>
      ) : null}
      {state.conflicts?.length ? (
        <div className="rounded-md border border-status-expiring/40 bg-status-expiring/5 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 font-medium text-status-expiring">
            <AlertTriangle className="h-4 w-4" /> Skipped — already booked for an overlapping shift
          </div>
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {state.conflicts.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">1 — Where and when</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Client</span>
            <select
              className={fld}
              value={client}
              onChange={(e) => {
                setClient(e.target.value);
                setProjectMode(e.target.value === "__new__" ? "__new__" : "");
              }}
            >
              <option value="">{clientNames.length ? "Choose a client…" : "No clients yet — add one below"}</option>
              {clientNames.map((c) => <option key={c} value={c}>{titleCaseLabel(c)}</option>)}
              <option value="__new__">+ New client…</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Event</span>
            <select
              name={projectMode === "__new__" ? "projectMode" : "projectId"}
              required
              className={fld}
              value={projectMode}
              onChange={(e) => setProjectMode(e.target.value)}
              disabled={!client}
            >
              <option value="" disabled>
                {!client ? "Pick a client first" : clientEvents.length ? "Choose an event…" : "No events for this client yet"}
              </option>
              {clientEvents.map((p) => (
                <option key={p.id} value={p.id}>{titleCaseLabel(p.name)}</option>
              ))}
              <option value="__new__">+ New event…</option>
            </select>
          </label>

          {projectMode === "__new__" ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Client name</span>
                <input
                  name="newClient"
                  list="client-list"
                  required
                  defaultValue={client && client !== "__new__" ? client : (preselectClient ?? "")}
                  placeholder="e.g. MANDARIN ORIENTAL"
                  className={fld}
                />
                <datalist id="client-list">
                  {clientNames.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Event name</span>
                <input name="newProject" placeholder="leave blank to use the client name" className={fld} />
              </label>
            </>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Event date</span>
            <input type="date" name="eventDate" required defaultValue={defaultDate} className={fld} />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Location</span>
            <input name="location" list="loc-list" placeholder="defaults to the event's" className={fld} />
            <datalist id="loc-list">
              {locations.map((l) => <option key={l} value={l} />)}
            </datalist>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Shift</span>
            <select name="shift" className={fld} defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="">—</option>
              {shifts.map((s) => <option key={s.value} value={s.value}>{titleCaseLabel(s.value)}</option>)}
            </select>
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
            <input type="number" name="breakMinutes" min={0} max={600} defaultValue={0} className={fld} />
          </label>

          <label className="block space-y-1 lg:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Staff Category</span>
            <input name="duty" list="duty-list" placeholder="e.g. Waiter, Hostess, Commis" className={fld} />
            <datalist id="duty-list">
              {categories.map((c) => <option key={c} value={titleCaseLabel(c)} />)}
            </datalist>
          </label>

          <label className="block space-y-1 lg:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <input name="notes" className={fld} />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            2 — Who <span className="ml-1 font-normal text-muted-foreground">({picked.size} selected)</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or staff no."
                className="rounded-md border border-input bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-gold"
              />
            </div>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-md border border-input bg-white px-2 py-2 text-sm outline-none focus:border-brand-gold">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{titleCaseLabel(c)}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyCompliant} onChange={(e) => setOnlyCompliant(e.target.checked)} className="h-4 w-4" />
              Documents complete only
            </label>
          </div>
        </div>

        <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="table-head sticky top-0">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    className="h-4 w-4 align-middle"
                    checked={visible.length > 0 && visible.every((s) => picked.has(s.id))}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const n = new Set(prev);
                        for (const s of visible) { if (e.target.checked) n.add(s.id); else n.delete(s.id); }
                        return n;
                      })
                    }
                  />
                </th>
                {["No.", "Name", "Category", "Location", "Documents"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">No staff match.</td></tr>
              ) : visible.map((s) => (
                <tr key={s.id} className={`border-t border-border ${picked.has(s.id) ? "bg-brand-gold/10" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${s.fullName}`} className="h-4 w-4 align-middle" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{s.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{titleCaseName(s.fullName)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{titleCaseLabel(s.category) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{titleCaseLabel(s.location) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {s.compliant
                      ? <span className="text-xs font-semibold text-status-valid">Complete</span>
                      : <span className="text-xs font-semibold text-status-expiring" title={s.issue}>{s.issue}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Anyone already booked for an overlapping shift is rejected on save and listed above — the
          database refuses double-bookings outright, so a second scheduler cannot slip one through.
        </p>
      </section>

        <button
          type="submit"
          disabled={pending || picked.size === 0}
          className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
        >
          <CalendarPlus className="h-4 w-4" />
          {pending ? "Saving…" : `Save ${picked.size || ""} staff`}
        </button>
      </form>

      <ScheduledList
        shifts={recent}
        presets={shifts}
        locations={locations}
        categories={categories}
        patch={patchRecent}
        remove={dropRecent}
      />
    </div>
  );
}

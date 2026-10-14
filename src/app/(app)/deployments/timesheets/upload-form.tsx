"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileWarning, MinusCircle, PlusCircle, RefreshCw, Upload } from "lucide-react";
import { FilePicker } from "@/components/file-picker";
import type { SheetOptions } from "@/lib/timesheet-match";
import { checkTimesheets, recheckTimesheets, recordTimesheets, type UploadState } from "./actions";

const ACCEPT = ".xlsx,.csv,.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif";

export type ClientOption = { name: string; events: string[] };

// Check → (adjust a sheet's date / client / event → check again) → Record.
// The chosen files live in React state, not in the <form>: React resets a form after its
// action runs, which used to empty the file input between steps and produced "Choose a
// timesheet file first." on a file that was plainly selected. After the first check the
// server hands back what it read (signed), so checking again and recording never re-read
// or re-upload the files.
export function TimesheetUploadForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const listId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<UploadState>({});
  const [choices, setChoices] = useState<Record<string, SheetOptions>>({});
  const [dirty, setDirty] = useState(false); // choices changed since the last check
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"check" | "recheck" | "record" | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const needsReading = files.some((f) => !/\.xlsx$/i.test(f.name));
  const toSave = (state.counts?.update ?? 0) + (state.counts?.create ?? 0);
  const canRecord = !!state.token && !state.applied && toSave > 0;
  const sheets = (state.sheets ?? []).filter((s) => s.newShifts > 0 || s.dateConflict || s.needsClient);

  const ICON = {
    update: <CheckCircle2 className="h-3.5 w-3.5 text-status-valid" />,
    create: <PlusCircle className="h-3.5 w-3.5 text-[#2f6bd8]" />,
    unchanged: <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />,
    error: <AlertTriangle className="h-3.5 w-3.5 text-status-expired" />,
  };

  const failed = (e: unknown): UploadState => ({
    error: `The upload did not go through${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again, or upload fewer or smaller files.`,
  });

  function check(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    setStep("check");
    setState({});
    setChoices({});
    setDirty(false);
    startTransition(async () => {
      try { setState(await checkTimesheets(fd)); } catch (err) { setState(failed(err)); }
    });
  }

  function recheck() {
    if (!state.token) return;
    const token = state.token;
    setStep("recheck");
    startTransition(async () => {
      try {
        const res = await recheckTimesheets(token, choices);
        setState({ ...res, fileProblems: state.fileProblems });
        setDirty(false);
      } catch (err) { setState({ ...state, ...failed(err) }); }
    });
  }

  function record() {
    if (!state.token) return;
    const token = state.token;
    setStep("record");
    startTransition(async () => {
      try {
        const res = await recordTimesheets(token, choices);
        setState(res);
        if (res.applied) {
          setFiles([]);
          setPickerKey((k) => k + 1);
          router.refresh();
        }
      } catch (err) {
        setState({ ...state, ...failed(err) });
      }
    });
  }

  const setChoice = (file: string, patch: SheetOptions) => {
    setChoices((c) => ({ ...c, [file]: { ...c[file], ...patch } }));
    setDirty(true);
  };

  return (
    <form onSubmit={check} className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">2 — Upload the filled-in timesheets</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload the Excel you downloaded above, or whatever the venue sent back — a PDF, a photo of
          the signed sheet, or their own spreadsheet. Each line is matched to its scheduled shift by
          <strong> Deployment ID</strong>, Staff ID or name and date. If nobody scheduled the shift,
          one is created from the timesheet for the matching staff profile. Nothing is saved until
          you have seen the summary and confirmed.
        </p>
        <div className="mt-3">
          <FilePicker
            key={pickerKey}
            name="files"
            multiple
            accept={ACCEPT}
            hint="Excel (.xlsx), CSV, PDF, or photos (JPG, PNG, HEIC) — up to 10 files, 20 MB each"
            buttonLabel="Choose timesheets"
            onFiles={(list) => { setFiles(list); setState({}); setChoices({}); }}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !files.length}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {pending && step === "check" ? (needsReading ? "Reading timesheets…" : "Checking…") : "Check these files"}
        </button>
        {pending && step === "check" && needsReading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            PDFs and photos are read line by line — this can take up to a minute per file.
          </p>
        ) : null}
      </div>

      {state.error ? (
        <div className="rounded-md bg-status-expired/10 px-3 py-2 text-sm text-status-expired">{state.error}</div>
      ) : null}
      {state.fileProblems?.length ? (
        <div className="rounded-md border border-status-expiring/40 bg-status-expiring/10 px-3 py-2 text-sm text-foreground">
          <div className="flex items-center gap-1.5 font-medium"><FileWarning className="h-4 w-4" /> Not used</div>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs">
            {state.fileProblems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md bg-status-valid/10 px-3 py-2 text-sm text-status-valid">{state.ok}</div>
      ) : null}

      {!state.applied && sheets.length ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Sheet details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Used for lines with no scheduled shift. Correct anything the reader got wrong, then check again.
          </p>
          <datalist id={`${listId}-clients`}>
            {clients.map((c) => <option key={c.name} value={c.name} />)}
          </datalist>
          <div className="mt-3 space-y-3">
            {sheets.map((s) => {
              const c = choices[s.name] ?? {};
              const clientVal = c.client ?? s.client ?? "";
              const events = clients.find((x) => x.name === clientVal.toUpperCase())?.events ?? [];
              return (
                <div key={s.name} className="rounded-lg border border-border p-3">
                  <div className="text-xs font-medium text-foreground">{s.name}</div>
                  {s.dateConflict ? (
                    <p className="mt-1 text-xs text-status-expired">
                      The heading says <strong>{s.detectedDate}</strong> but the lines say <strong>{s.lineDates.join(", ")}</strong>.
                      Pick the right date:
                      {[s.detectedDate, ...s.lineDates].filter((d, i, a): d is string => !!d && a.indexOf(d) === i).map((d) => (
                        <button key={d} type="button" onClick={() => setChoice(s.name, { date: d })}
                          className={`ms-2 rounded border px-1.5 py-0.5 ${c.date === d ? "border-brand-navy bg-brand-navy text-white" : "border-border hover:bg-secondary"}`}>
                          {d}
                        </button>
                      ))}
                    </p>
                  ) : null}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-[11px] text-muted-foreground">
                      Date
                      <input type="date" value={c.date ?? s.date ?? ""} onChange={(e) => setChoice(s.name, { date: e.target.value })}
                        className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs text-foreground" />
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      Client
                      <input list={`${listId}-clients`} value={clientVal} placeholder="e.g. MADINAT"
                        onChange={(e) => setChoice(s.name, { client: e.target.value })}
                        className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs uppercase text-foreground" />
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      Event
                      <input list={`${listId}-events-${s.name}`} value={c.event ?? s.event ?? ""} placeholder="defaults to the outlet or client"
                        onChange={(e) => setChoice(s.name, { event: e.target.value })}
                        className="mt-0.5 w-full rounded border border-input px-2 py-1 text-xs uppercase text-foreground" />
                      <datalist id={`${listId}-events-${s.name}`}>
                        {events.map((ev) => <option key={ev} value={ev} />)}
                      </datalist>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={recheck}
            disabled={pending}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {pending && step === "recheck" ? "Checking…" : "Check again with these details"}
          </button>
        </div>
      ) : null}

      {state.plan?.length ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {state.applied ? "What was saved" : "What these files would do"}
              <span className="ms-2 text-xs font-normal text-muted-foreground">{state.fileNames?.join(", ")}</span>
            </h2>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-status-valid">{state.counts?.update ?? 0} scheduled shifts filled in</span>
              <span className="text-[#2f6bd8]">{state.counts?.create ?? 0} new shifts</span>
              <span className="text-muted-foreground">{state.counts?.unchanged ?? 0} unchanged</span>
              <span className={state.counts?.error ? "text-status-expired" : "text-muted-foreground"}>
                {state.counts?.error ?? 0} with a problem
              </span>
              {toSave ? <span className="font-medium text-foreground">Total {state.totalHours}</span> : null}
            </div>
          </div>

          <div className="mt-3 max-h-[26rem] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Shift</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.plan.map((p, i) => (
                  <tr key={`${p.sheetRow}-${i}`} className={p.action === "error" ? "bg-status-expired/5" : undefined}>
                    <td className="max-w-[14rem] px-3 py-2 text-muted-foreground">{p.source ?? `Row ${p.sheetRow}`}</td>
                    <td className="px-3 py-2">{p.label === p.source ? "—" : p.label}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-start gap-1.5">
                        <span className="mt-0.5 flex-none">{ICON[p.action]}</span>
                        <span className={p.action === "error" ? "text-status-expired" : "text-foreground"}>{p.detail}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canRecord ? (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                Rows with a problem are skipped — fix them and upload again. Lines marked
                <strong> check</strong> were matched by name or had something hard to read; look at
                them before recording. Saving marks the shifts <strong>Timesheet submitted</strong>;
                verify and approve them on the Deployments page and the hours appear in the Payroll
                and Client billing reports.
              </p>
              {dirty ? (
                <p className="mt-2 text-xs text-status-expired">You changed the sheet details — check again before recording.</p>
              ) : null}
              <button
                type="button"
                onClick={record}
                disabled={pending || dirty}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {pending && step === "record" ? "Saving…" : `Record ${toSave} timesheet${toSave === 1 ? "" : "s"} (${state.totalHours})`}
              </button>
            </>
          ) : null}

          {state.applied ? (
            <button
              type="button"
              onClick={() => router.push("/deployments?status=TIMESHEET_SUBMITTED")}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              Verify and approve them
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

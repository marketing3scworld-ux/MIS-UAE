"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEnterTimesheet, formatHM, type Actor } from "@/lib/deployment";
import { NotTemplateError, readTimesheetWorkbook, workbookToText } from "@/lib/timesheet-sheet";
import { extractTimesheet, type ExtractInput } from "@/lib/timesheet-ocr";
import type { SheetOptions } from "@/lib/timesheet-match";
import { evaluateUpload, applyNewShifts, type SheetSummary, type UploadData } from "@/lib/timesheet-evaluate";
import { applyTimesheetTargets } from "@/lib/timesheet-plan";
import type { PlanRow } from "@/lib/timesheet-plan";
import { issueToken, readToken } from "@/lib/timesheet-token";

// Bulk timesheet entry, in three calls:
//   checkTimesheets   — read every uploaded file (template .xlsx directly; PDFs, photos,
//                       CSVs and other spreadsheets through the document reader) and report
//                       what would happen. Writes nothing.
//   recheckTimesheets — the same report after the reviewer sets a sheet's date, client or
//                       event on screen. Uses what was already read; files are not re-read.
//   recordTimesheets  — save exactly that: fill in scheduled shifts, create the ones that
//                       were not scheduled.
// The rules live in lib/timesheet-evaluate.ts, lib/timesheet-match.ts and lib/timesheet-plan.ts.

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // keep in step with serverActions.bodySizeLimit in next.config.ts

const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif)$/i;

// PlanRow and SheetSummary are deliberately NOT re-exported from here. In a "use server"
// file the `export type { X }` form survives the transform as a real runtime export and
// throws "X is not defined" on module evaluation; an inline `export type X = ...` like
// UploadState below is erased properly. Consumers import them from @/lib instead.
export type UploadState = {
  error?: string;
  ok?: string;
  applied?: boolean;
  fileNames?: string[];
  fileProblems?: string[]; // a whole file that could not be used, with the reason
  plan?: PlanRow[];
  counts?: { update: number; create: number; unchanged: number; error: number };
  sheets?: SheetSummary[];
  totalHours?: string;
  token?: string;
};

export type SheetChoices = Record<string, SheetOptions>;

async function actor(): Promise<{ id: number; a: Actor } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const me = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { id: true, role: true, isOperationsHead: true },
  });
  if (!me) return null;
  return { id: me.id, a: { role: me.role, isOperationsHead: me.isOperationsHead } };
}

/** Only well-formed choices get through: a real yyyy-mm-dd date and short names. */
function cleanChoices(raw: unknown): SheetChoices {
  const out: SheetChoices = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [file, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const opt: SheetOptions = {};
    const date = typeof o.date === "string" ? o.date.trim() : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))) opt.date = date;
    const name = (x: unknown) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 120) : "");
    if (name(o.client)) opt.client = name(o.client);
    if (name(o.event)) opt.event = name(o.event);
    out[file.slice(0, 260)] = opt;
  }
  return out;
}

async function report(data: UploadData, choices: SheetChoices, a: Actor, extra: Partial<UploadState> = {}): Promise<UploadState & { _eval: Awaited<ReturnType<typeof evaluateUpload>> }> {
  const ev = await evaluateUpload(data, choices, a);
  const toSave = ev.counts.update + ev.counts.create;
  return {
    fileNames: data.files,
    plan: ev.plan,
    counts: ev.counts,
    sheets: ev.sheets,
    totalHours: formatHM(ev.totalMinutes),
    ok: toSave
      ? `Ready to record ${toSave} timesheet${toSave === 1 ? "" : "s"} — ${formatHM(ev.totalMinutes)} in total` +
        (ev.counts.create ? `, including ${ev.counts.create} shift${ev.counts.create === 1 ? " that was" : "s that were"} not scheduled` : "") +
        ". Nothing has been saved yet."
      : "Nothing from these files would record any hours.",
    ...extra,
    _eval: ev,
  };
}

export async function checkTimesheets(formData: FormData): Promise<UploadState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canEnterTimesheet(me.a)) return { error: "You do not have permission to enter timesheets." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose at least one timesheet file first." };
  if (files.length > MAX_FILES) return { error: `Upload at most ${MAX_FILES} files at a time.` };
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return { error: "Those files add up to more than 25 MB — upload them in smaller batches." };

  const fileProblems: string[] = [];
  const data: UploadData = { files: files.map((f) => f.name), template: [], read: [], nextRow: 1 };

  // Files are read one after another: a venue's batch is usually a handful of pages,
  // and parallel scans would only trade a little speed for hitting rate limits.
  for (const file of files) {
    const problem = (why: string) => fileProblems.push(`${file.name}: ${why}`);
    if (file.size > MAX_FILE_BYTES) { problem("larger than 20 MB."); continue; }

    const name = file.name;
    let input: ExtractInput | null = null;

    if (/\.xlsx$/i.test(name)) {
      const buf = await file.arrayBuffer();
      try {
        const parsed = await readTimesheetWorkbook(buf);
        if (parsed.missing.length) { problem(`the template is missing these columns: ${parsed.missing.join(", ")}.`); continue; }
        if (!parsed.rows.length) { problem("no timesheet rows in it."); continue; }
        data.template.push({
          file: name,
          rows: parsed.rows.map((r) => ({ ...r, row: data.nextRow++, source: files.length > 1 ? `${name} · row ${r.row}` : undefined })),
        });
        continue;
      } catch (e) {
        if (!(e instanceof NotTemplateError)) { problem("this spreadsheet could not be opened."); continue; }
        // Not our template — the venue's own layout. Read it like any other document.
        input = { kind: "table", name, text: await workbookToText(buf) };
      }
    } else if (/\.csv$/i.test(name)) {
      input = { kind: "table", name, text: await file.text() };
    } else if (/\.pdf$/i.test(name)) {
      input = { kind: "pdf", name, bytes: Buffer.from(await file.arrayBuffer()) };
    } else if (IMAGE_EXT.test(name)) {
      input = { kind: "image", name, bytes: Buffer.from(await file.arrayBuffer()) };
    } else if (/\.xls$/i.test(name)) {
      problem("old .xls format — open it in Excel and save it as .xlsx."); continue;
    } else {
      problem("unsupported file type. Use Excel (.xlsx), CSV, PDF, or a photo (JPG, PNG)."); continue;
    }

    const res = await extractTimesheet(input);
    if (!res.ok) { problem(res.reason); continue; }
    if (!res.isTimesheet) { problem(`this does not look like a timesheet${res.notTimesheetReason ? ` — ${res.notTimesheetReason}` : ""}.`); continue; }
    if (!res.rows.length) { problem("no worker lines could be read from it."); continue; }
    data.read.push({
      name, documentDate: res.documentDate, clientName: res.clientName, location: res.location,
      sheetNo: res.sheetNo, rows: res.rows,
    });
  }

  if (!data.template.length && !data.read.length) {
    return { fileNames: data.files, fileProblems, error: fileProblems.length ? "None of the files could be used." : "No timesheet rows were found." };
  }

  const { _eval, ...state } = await report(data, {}, me.a, { fileProblems });
  void _eval;
  return { ...state, token: issueToken(me.id, data) };
}

export async function recheckTimesheets(token: string, choices: unknown): Promise<UploadState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canEnterTimesheet(me.a)) return { error: "You do not have permission to enter timesheets." };
  const data = readToken(token, me.id);
  if (!data) return { error: "This check has expired — choose the files and check them again." };
  const { _eval, ...state } = await report(data, cleanChoices(choices), me.a);
  void _eval;
  return { ...state, token };
}

export async function recordTimesheets(token: string, choices: unknown): Promise<UploadState> {
  const me = await actor();
  if (!me) return { error: "Not authenticated." };
  if (!canEnterTimesheet(me.a)) return { error: "You do not have permission to enter timesheets." };
  const data = readToken(token, me.id);
  if (!data) return { error: "This check has expired — choose the files and check them again." };

  // Worked out again against the database as it is now: a shift approved, cancelled or
  // booked since the check is reported instead of overwritten.
  const { _eval: ev, ...state } = await report(data, cleanChoices(choices), me.a);
  if (!ev.updates.length && !ev.creates.length) {
    return { ...state, token, error: "There is nothing to save — check the rows with a problem." };
  }

  const updated = await applyTimesheetTargets(ev.updates, me.id);
  const created = await applyNewShifts(ev.creates, me.id);

  revalidatePath("/deployments");
  revalidatePath("/reports");
  revalidatePath("/dashboard");

  const reopened = ev.updates.filter((t) => t.wasApproved).length;
  const bits = [`Recorded ${updated.written + created.written} timesheet${updated.written + created.written === 1 ? "" : "s"} (${state.totalHours})`];
  if (created.written) bits[0] += `, creating ${created.written} shift${created.written === 1 ? " that was" : "s that were"} not scheduled`;
  bits[0] += ".";
  if (reopened) bits.push(`${reopened} previously approved row${reopened === 1 ? " was" : "s were"} reopened and need re-approval.`);
  bits.push("Next: verify and approve them on the Deployments page — approved hours appear in the Payroll and Client billing reports.");
  const failed = [...updated.failed, ...created.failed];

  return {
    ...state,
    applied: true,
    ok: bits.join(" "),
    error: failed.length ? `Could not save ${failed.length} row(s): ${failed.slice(0, 5).join("; ")}` : undefined,
  };
}

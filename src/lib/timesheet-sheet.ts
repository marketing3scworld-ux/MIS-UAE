import ExcelJS from "exceljs";

// The timesheet round-trip: the app exports one row per scheduled shift, the venue
// fills in what actually happened, and the same file comes back in. Both halves are
// defined here so the columns written can never drift from the columns read.
//
// Matching is by DEPLOYMENT ID, written into the template as a locked-looking first
// column. These hours become wages and invoices, so a row that cannot be tied to a
// specific shift with certainty is reported rather than guessed at — the same stance
// scripts/import-ibans.ts takes about names.

export const TS_HEADERS = {
  id: "Deployment ID",
  date: "Event date",
  client: "Client",
  event: "Event",
  location: "Location",
  staffId: "Staff ID",
  staff: "Staff name",
  category: "Category",
  scheduled: "Scheduled",
  actualIn: "Actual in",
  actualOut: "Actual out",
  break: "Break (min)",
  noShow: "No-show",
  notes: "Notes",
} as const;

/** Columns the venue fills in. Everything else in the template is read-only context. */
export const FILLABLE = [TS_HEADERS.actualIn, TS_HEADERS.actualOut, TS_HEADERS.break, TS_HEADERS.noShow, TS_HEADERS.notes];

export type SheetRow = {
  row: number;
  deploymentId: number | null;
  staffId: number | null;
  eventDate: string | null; // yyyy-mm-dd
  actualIn: string | null; // "HH:MM"
  actualOut: string | null;
  breakMinutes: number | null;
  noShow: boolean;
  notes: string | null;
  blank: boolean; // nothing was filled in on this row
  // Context columns printed on the template. Only used when the row's shift no longer
  // exists, so the hours can still be tied to the right person, client and event.
  staffName?: string | null;
  clientName?: string | null;
  eventName?: string | null;
  location?: string | null;
  source?: string; // "Timesheet.pdf · page 1, line 4" — shown instead of the bare row number
  matchNote?: string; // how a row without a Deployment ID was tied to its shift, for the reviewer
  timesheetNo?: number | null; // the venue's own sheet number, read off the heading
};

/** The workbook is not the app's template — the caller can hand it to the document reader instead. */
export class NotTemplateError extends Error {}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("hyperlink" in o && "text" in o) return cellText(o.text);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A time as the venue might have written it: a real Excel time cell (Date), an Excel
 * serial fraction (0.5 = 12:00), or typed text ("14:30", "2:30 pm", "1430").
 * Returns "HH:MM", or null when the cell is empty or unreadable.
 */
export function parseTimeHHMM(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;

  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return parseTimeHHMM(o.result);
    if ("text" in o) return parseTimeHHMM(o.text);
  }

  if (typeof v === "number") {
    // Excel stores a time as a fraction of a day; a datetime serial carries a whole
    // part we don't care about here.
    const frac = v - Math.floor(v);
    const mins = Math.round(frac * 24 * 60);
    if (mins < 0 || mins > 1440) return null;
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }

  const s = String(v).trim().toLowerCase();
  if (!s) return null;

  const ampm = /(am|pm)\s*$/.exec(s)?.[1];
  const digits = s.replace(/\s*(am|pm)\s*$/, "").trim();

  let h: number, m: number;
  const colon = /^(\d{1,2})[:.](\d{2})$/.exec(digits);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{3,4}$/.test(digits)) {
    // "1430" / "930"
    h = Number(digits.slice(0, digits.length - 2));
    m = Number(digits.slice(-2));
  } else if (/^\d{1,2}$/.test(digits)) {
    h = Number(digits);
    m = 0;
  } else {
    return null;
  }

  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** yyyy-mm-dd from a Date cell, an Excel serial, or common typed forms. */
export function parseDateISO(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return parseDateISO(o.result);
    if ("text" in o) return parseDateISO(o.text);
  }
  if (typeof v === "number") {
    const t = new Date((v - 25569) * 86400 * 1000);
    if (Number.isNaN(t.getTime())) return null;
    return t.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // UAE convention is day-first; "03/04/2026" is 3 April, never 4 March.
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  // "17 Sep 2026" — how the downloaded template writes the event date.
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`;
  }
  return null;
}

export function parseNoShow(v: unknown): boolean {
  const s = cellText(v).trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1" || s === "x" || s === "absent";
}

function parseIntOrNull(v: unknown): number | null {
  const s = cellText(v).replace(/[^\d-]/g, "");
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a filled-in timesheet. Headers are located by name rather than position so a
 * venue that reorders or inserts columns still imports; only the header text matters.
 */
export async function readTimesheetWorkbook(buf: ArrayBuffer): Promise<{ rows: SheetRow[]; headerRow: number; missing: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("That file has no worksheets.");

  // The template carries a title and subtitle above the headers, so the header row is
  // found by content rather than assumed to be row 1.
  let headerRow = 0;
  const col: Record<string, number> = {};
  const wanted = Object.values(TS_HEADERS).map((h) => h.toLowerCase());
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const found: Record<string, number> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = cellText(ws.getRow(r).getCell(c).value).toLowerCase();
      if (h && wanted.includes(h)) found[h] = c;
    }
    if (Object.keys(found).length >= 3) {
      headerRow = r;
      Object.assign(col, found);
      break;
    }
  }
  if (!headerRow) throw new NotTemplateError("Could not find the header row — is this a timesheet template?");

  const need = [TS_HEADERS.id, TS_HEADERS.actualIn, TS_HEADERS.actualOut];
  const missing = need.filter((h) => !col[h.toLowerCase()]);

  const at = (r: number, header: string) => {
    const c = col[header.toLowerCase()];
    return c ? ws.getRow(r).getCell(c).value : null;
  };

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const idRaw = at(r, TS_HEADERS.id);
    const inRaw = at(r, TS_HEADERS.actualIn);
    const outRaw = at(r, TS_HEADERS.actualOut);
    const brkRaw = at(r, TS_HEADERS.break);
    const nsRaw = at(r, TS_HEADERS.noShow);
    const notesRaw = at(r, TS_HEADERS.notes);

    const deploymentId = parseIntOrNull(idRaw);
    const staffId = parseIntOrNull(at(r, TS_HEADERS.staffId));
    const eventDate = parseDateISO(at(r, TS_HEADERS.date));

    // A totals strip or a stray note under the table has no id and nothing filled in.
    const anyFilled =
      cellText(inRaw) !== "" || cellText(outRaw) !== "" || cellText(brkRaw) !== "" ||
      cellText(nsRaw) !== "" || cellText(notesRaw) !== "";
    if (!deploymentId && !staffId && !anyFilled) continue;

    rows.push({
      row: r,
      deploymentId,
      staffId,
      eventDate,
      actualIn: parseTimeHHMM(inRaw),
      actualOut: parseTimeHHMM(outRaw),
      breakMinutes: parseIntOrNull(brkRaw),
      noShow: parseNoShow(nsRaw),
      notes: cellText(notesRaw) || null,
      blank: !anyFilled,
      staffName: cellText(at(r, TS_HEADERS.staff)) || null,
      clientName: cellText(at(r, TS_HEADERS.client)) || null,
      eventName: cellText(at(r, TS_HEADERS.event)) || null,
      location: cellText(at(r, TS_HEADERS.location)) || null,
    });
  }

  return { rows, headerRow, missing };
}

/**
 * A spreadsheet in someone else's layout, flattened to text for the document reader.
 * Dates and times are written out unambiguously so nothing depends on Excel's locale.
 */
export async function workbookToText(buf: ArrayBuffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const show = (v: unknown): string => {
    if (v instanceof Date) {
      const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
      if (v.getUTCFullYear() < 1901) return t; // a time-only cell sits on Excel's 1899 epoch
      const d = v.toISOString().slice(0, 10);
      return v.getUTCHours() || v.getUTCMinutes() ? `${d} ${t}` : d;
    }
    if (v && typeof v === "object" && "result" in (v as object)) return show((v as { result: unknown }).result);
    return cellText(v);
  };
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    out.push(`## Sheet "${ws.name}"`);
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells = (row.values as unknown[]).slice(1).map(show);
      if (cells.some((c) => c !== "")) out.push(`R${n}: ${cells.join(" | ")}`);
    });
  }
  return out.join("\n");
}

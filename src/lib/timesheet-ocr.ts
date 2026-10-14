// Reads a timesheet the venue sent back in whatever form it arrived — a scanned or
// exported PDF, a phone photo, or a spreadsheet in the venue's own layout — and
// returns one row per worker-shift line. Server-only: ANTHROPIC_API_KEY never
// reaches the browser.
//
// This only TRANSCRIBES. Deciding which shift a line belongs to is done afterwards
// in lib/timesheet-match.ts with fixed rules, because these hours become wages and a
// model's guess about "which Ahmed" is not good enough. Anything illegible comes
// back empty (with a note), never invented.
//
// Like eid-ocr.ts it never throws: failures return { ok: false, reason } so the
// upload screen can say what went wrong for that one file.
import Anthropic from "@anthropic-ai/sdk";

// Same default as the EID reader. TIMESHEET_OCR_MODEL overrides it for this feature only.
const MODEL = process.env.TIMESHEET_OCR_MODEL || process.env.EID_OCR_MODEL || "claude-opus-5";

// A spreadsheet is sent as text; beyond this the venue should split the file rather
// than have rows silently cut off.
const MAX_TABLE_CHARS = 400_000;

export type ExtractedRow = {
  source: string; // where on the document, e.g. "page 1, line 4"
  deploymentId: number | null;
  staffNumber: number | null;
  staffName: string | null;
  date: string | null; // yyyy-mm-dd
  timeIn: string | null; // as transcribed; parsed later
  timeOut: string | null;
  breakMinutes: number | null;
  noShow: boolean;
  notes: string | null;
  unclear: string | null; // what could not be read with confidence
};

export type ExtractInput =
  | { kind: "pdf"; name: string; bytes: Buffer }
  | { kind: "image"; name: string; bytes: Buffer }
  | { kind: "table"; name: string; text: string };

export type ExtractResult =
  | {
      ok: true; isTimesheet: boolean; notTimesheetReason: string;
      documentDate: string | null; clientName: string | null; location: string | null;
      sheetNo: number | null;
      rows: ExtractedRow[];
    }
  | { ok: false; reason: string };

const SYSTEM = `You transcribe staff timesheets for an event-staffing company's HR system. The operator is
authorised to process these records; they are used to pay staff for hours worked.

Transcribe exactly what the document says. Never invent, estimate or "correct" a value: if something is
blank, crossed out or illegible, leave that field empty and say what was unclear in "unclear".`;

const INSTRUCTION = `Read this timesheet and return one entry in "rows" for every line that records a worker's
shift. Skip headings, column titles, totals, signatures and blank lines.

- deployment_id: ONLY a number from a column headed "Deployment ID" / "Dep ID", else "". Serial numbers
  (S.No, SR.No., sheet or invoice numbers) are NOT deployment IDs.
- staff_id: ONLY a number from a column headed "Staff ID" / "Staff No." / "Emp #", else "".
- staff_name: the worker's name exactly as written, including initials.
- date: the shift date as YYYY-MM-DD. Dates on these sheets are written DAY FIRST (03/04/2026 is 3 April 2026;
  12-10-26 is 12 October 2026). When a date is written only on the first of several lines, it applies to the
  lines below it until another date appears — fill it in on each of those lines.
  document_date is the date printed in the sheet's heading, if any. If the heading date and the line dates
  disagree, keep each as written and say so in "unclear" on the affected lines.
- time_in / time_out: the ACTUAL times worked, as 24-hour HH:MM. If am/pm is not written, take the reading that
  makes a sensible shift (time out after time in, usually under 16 hours) and say so in "unclear".
  If the sheet shows both scheduled and actual times, use the actual ones.
- break_minutes: break length in whole minutes ("1 hr" = 60), else "".
- no_show: true only if the line clearly marks the worker absent / no-show.
- notes: only a remark someone wrote about that shift (e.g. "late", "left early", "replaced by Ali"), else "".
  Do not copy other columns into notes — not total hours, category, signatures or serial numbers.
- source: where the line is, e.g. "page 2, line 5".

Also record, from the sheet's heading: client_name (the client / venue the staff were supplied to, e.g. the
"Client Name" field), location (the outlet or location field), and sheet_no — the timesheet's own serial
number, printed as "SR. No.", "S.No" or "Timesheet No." at the top (digits only, "" if absent). Each is ""
if not filled in. The staffing company's own name and logo are not the client.

If this document is not a timesheet at all (for example a staff list, a CV or an invoice), set is_timesheet to
false, explain why in reason_if_not, and return no rows.`;

const ROW_FIELDS = [
  "source", "deployment_id", "staff_id", "staff_name", "date", "time_in", "time_out",
  "break_minutes", "no_show", "notes", "unclear",
] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_timesheet", "reason_if_not", "document_date", "client_name", "location", "sheet_no", "rows"],
  properties: {
    is_timesheet: { type: "boolean" },
    reason_if_not: { type: "string" },
    document_date: { type: "string", description: "YYYY-MM-DD if one date applies to the whole sheet, else empty" },
    client_name: { type: "string" },
    location: { type: "string" },
    sheet_no: { type: "string", description: "the sheet's own SR./S. number, digits only" },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [...ROW_FIELDS],
        properties: {
          source: { type: "string" },
          deployment_id: { type: "string" },
          staff_id: { type: "string" },
          staff_name: { type: "string" },
          date: { type: "string" },
          time_in: { type: "string" },
          time_out: { type: "string" },
          break_minutes: { type: "string" },
          no_show: { type: "boolean" },
          notes: { type: "string" },
          unclear: { type: "string" },
        },
      },
    },
  },
} as const;

const text = (v: unknown) => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "n/a" ? s : null;
};
const int = (v: unknown) => {
  const s = text(v)?.replace(/[^\d]/g, "");
  return s ? Number.parseInt(s, 10) : null;
};
const isoDate = (v: unknown) => {
  const s = text(v);
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? s : null;
};

async function toContent(input: ExtractInput): Promise<Anthropic.Beta.BetaContentBlockParam | { error: string }> {
  if (input.kind === "table") {
    if (input.text.length > MAX_TABLE_CHARS) {
      return { error: "This spreadsheet is too large to read in one go — split it into smaller files (for example one per week)." };
    }
    return { type: "text", text: `<spreadsheet name="${input.name.replace(/"/g, "'")}">\n${input.text}\n</spreadsheet>` };
  }
  if (input.kind === "pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.bytes.toString("base64") } };
  }
  // Photos: undo phone rotation, keep enough resolution for handwriting in a table,
  // and re-encode as JPEG (also turns HEIC from iPhones into something the API takes).
  // sharp is a native module loaded on demand: if its binary will not load on this
  // server, a plain JPG/PNG/WEBP still goes through as it is.
  try {
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(input.bytes, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch {
    const media = sniffImage(input.bytes);
    if (media && input.bytes.length <= MAX_RAW_IMAGE_BYTES) {
      return { type: "image", source: { type: "base64", media_type: media, data: input.bytes.toString("base64") } };
    }
    return { error: media ? "This photo is too large — upload one under 5 MB, or a PDF." : "This image could not be opened — upload it as JPG, PNG or PDF." };
  }
}

// The API's own per-image limit, for photos sent without re-encoding.
const MAX_RAW_IMAGE_BYTES = 5 * 1024 * 1024;

function sniffImage(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function extractTimesheet(input: ExtractInput): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "Reading PDFs, photos and non-template spreadsheets needs ANTHROPIC_API_KEY in the server's .env." };
  }

  const content = await toContent(input);
  if ("error" in content) return { ok: false, reason: content.error };

  const client = new Anthropic({ apiKey });
  let raw: string;
  try {
    // Streaming: a multi-page scan can produce a long answer, and a non-streamed
    // request that size risks an HTTP timeout. fallbacks: "default" lets the API
    // retry on a fallback model if a safety classifier declines the document.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [content, { type: "text", text: INSTRUCTION }] }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      return { ok: false, reason: "The document could not be processed automatically. Enter these hours by hand." };
    }
    if (msg.stop_reason === "max_tokens") {
      return { ok: false, reason: "This timesheet has too many lines to read at once — split it into smaller files." };
    }
    raw = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, reason: "The ANTHROPIC_API_KEY on the server was rejected." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "The reading service is busy — try again in a minute." };
    if (err instanceof Anthropic.BadRequestError) return { ok: false, reason: `This file could not be read (${err.message}).` };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: `Reading service error ${err.status ?? ""}. Try again shortly.` };
    return { ok: false, reason: "Could not reach the reading service. Check the server's internet connection." };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The reading service returned something unexpected. Try again." };
  }

  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).map((r: Record<string, unknown>, i: number): ExtractedRow => ({
    source: text(r.source) ?? `line ${i + 1}`,
    deploymentId: int(r.deployment_id),
    staffNumber: int(r.staff_id),
    staffName: text(r.staff_name),
    date: isoDate(r.date),
    timeIn: text(r.time_in),
    timeOut: text(r.time_out),
    breakMinutes: int(r.break_minutes),
    noShow: r.no_show === true,
    notes: text(r.notes),
    unclear: text(r.unclear),
  }));

  return {
    ok: true,
    isTimesheet: parsed.is_timesheet !== false,
    notTimesheetReason: text(parsed.reason_if_not) ?? "",
    documentDate: isoDate(parsed.document_date),
    clientName: text(parsed.client_name),
    location: text(parsed.location),
    // Up to four digits, the way the venue's pads are numbered.
    sheetNo: (() => { const n = int(parsed.sheet_no); return n && n > 0 && n < 10000 ? n : null; })(),
    rows,
  };
}

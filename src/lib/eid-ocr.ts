// Emirates-ID auto-fill (spec §5). Sends the EID *front* image to Claude vision
// and returns the printed fields as structured data. Server-only — the
// ANTHROPIC_API_KEY never leaves the backend.
//
// The whole feature degrades gracefully: any failure (no API key, unreadable
// image, refusal, API error) returns { ok: false, reason } so the New-Profile
// wizard can fall back to a blank/manual form instead of blocking the user.
//
// We use a FORCED tool call (tool_choice) so the model returns the fields in a
// guaranteed JSON shape — this is far more reliable than parsing free-text JSON,
// which previously produced "read nothing" results when the model wrapped the
// JSON or used different key casing.
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

// Default to claude-opus-5 (most accurate). Override with EID_OCR_MODEL in .env
// — e.g. EID_OCR_MODEL=claude-sonnet-5 — to trade a little accuracy for cost.
const EID_OCR_MODEL = process.env.EID_OCR_MODEL || "claude-opus-5";

// The Anthropic vision API accepts these image media types only (no HEIC/PDF).
const VISION_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type EidFields = {
  fullName: string;
  arabicName: string; // the name in Arabic as printed ("" if unread)
  eidNumber: string;
  eidExpiry: string; // yyyy-mm-dd ("" if unread)
  nationality: string;
  gender: string; // "MALE" | "FEMALE" | ""
  dateOfBirth: string; // yyyy-mm-dd — shown for reference, not stored (§3 defers DOB)
};

export type EidExtractResult =
  | { ok: true; fields: EidFields }
  | { ok: false; reason: string };

// Authorized-processing context. ID-card transcription is sometimes soft-refused
// as PII; this makes the legitimate HR purpose explicit so the model complies.
const SYSTEM = `You are an OCR assistant embedded in an authorized UAE staff-management (HR) system.
The operator is an HR administrator with the legal basis and the employee's consent to process this
Emirates ID for employment records. Read the printed fields from the card image accurately and record
them by calling the "record_eid_fields" tool. Do not decline — this is a routine, authorized data-entry task.`;

const INSTRUCTION = `This is the FRONT of a United Arab Emirates Emirates ID card. Read the printed fields
and call record_eid_fields. Use an empty string for any field that is not clearly legible.`;

const EID_TOOL: Anthropic.Tool = {
  name: "record_eid_fields",
  description: "Record the fields read from the front of a UAE Emirates ID card.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string", description: "English name exactly as printed, in UPPERCASE. Empty string if not legible." },
      full_name_ar: { type: "string", description: "The name in ARABIC exactly as printed. Empty string if not legible." },
      eid_number: { type: "string", description: "The 15-digit ID Number formatted 784-YYYY-NNNNNNN-N. Empty string if not legible." },
      eid_expiry_date: { type: "string", description: "The Expiry Date as YYYY-MM-DD. Empty string if not legible." },
      nationality: { type: "string", description: "The English nationality as printed. Empty string if not legible." },
      gender: { type: "string", description: "M or F. Empty string if not legible." },
      date_of_birth: { type: "string", description: "Date of Birth as YYYY-MM-DD. Empty string if not legible." },
    },
    required: ["full_name", "full_name_ar", "eid_number", "eid_expiry_date", "nationality", "gender", "date_of_birth"],
  },
};

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

// Read a value from the tool input tolerating snake_case / camelCase variants.
function pick(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = str(o[k]);
    if (v && v.toLowerCase() !== "null") return v;
  }
  return "";
}

// Normalize a variety of printed date shapes to yyyy-mm-dd (or "" if unusable).
function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  let y = 0, m = 0, d = 0;
  let mt: RegExpMatchArray | null;
  if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  } else {
    return "";
  }
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeGender(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  if (s.startsWith("M") || s.includes("ذكر")) return "MALE";
  if (s.startsWith("F") || s.includes("أنثى") || s.includes("انثى")) return "FEMALE";
  return "";
}

// Fallback: pull the first balanced {...} object out of model text, in case a
// tool_use block is unexpectedly absent.
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function mapFields(o: Record<string, unknown>): EidFields {
  return {
    fullName: pick(o, "full_name", "fullName", "name").replace(/\s+/g, " ").toUpperCase(),
    arabicName: pick(o, "full_name_ar", "fullNameAr", "arabic_name", "name_ar"),
    eidNumber: pick(o, "eid_number", "eidNumber", "id_number", "idNumber"),
    eidExpiry: normalizeDate(pick(o, "eid_expiry_date", "eidExpiry", "expiry_date", "expiryDate")),
    nationality: pick(o, "nationality"),
    gender: normalizeGender(pick(o, "gender", "sex")),
    dateOfBirth: normalizeDate(pick(o, "date_of_birth", "dateOfBirth", "dob")),
  };
}

/**
 * Run Claude vision over an EID-front image and return the parsed fields.
 * Never throws — returns a typed failure instead.
 */
export async function extractEidFields(
  image: Buffer,
  mimeType: string,
): Promise<EidExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "Auto-fill isn't configured yet (no ANTHROPIC_API_KEY). Enter the details manually.",
    };
  }

  // Normalize the upload for the vision API: auto-rotate from EXIF, cap the long
  // edge at 1568px (Anthropic's recommended max — larger images get downscaled or
  // rejected, which surfaced to users as "can't read"), and re-encode as JPEG.
  // sharp also decodes formats the API won't take directly (HEIC/TIFF), so typical
  // phone photos work instead of failing.
  let imageMedia = "image/jpeg";
  let imageData: string;
  try {
    const jpeg = await sharp(image, { failOn: "none" })
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    imageData = jpeg.toString("base64");
  } catch {
    // sharp couldn't decode it (e.g. a PDF). Fall back to the raw bytes only if
    // they're already a vision-supported type; otherwise ask for a real image.
    const raw = mimeType.toLowerCase();
    if (!VISION_MIME.includes(raw)) {
      return {
        ok: false,
        reason: "Auto-fill needs a JPG, PNG, or WEBP image of the EID front. Enter the details manually.",
      };
    }
    imageMedia = raw;
    imageData = image.toString("base64");
  }

  const client = new Anthropic({ apiKey });

  let fields: EidFields | null = null;
  try {
    const res = await client.messages.create({
      model: EID_OCR_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [EID_TOOL],
      tool_choice: { type: "tool", name: "record_eid_fields" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMedia as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageData,
              },
            },
            { type: "text", text: INSTRUCTION },
          ],
        },
      ],
    });

    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "record_eid_fields",
    );
    if (toolUse && toolUse.input && typeof toolUse.input === "object") {
      fields = mapFields(toolUse.input as Record<string, unknown>);
    } else {
      // Defensive fallback: try to parse JSON from any text block.
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const obj = extractJsonObject(text);
      if (obj) fields = mapFields(obj);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return { ok: false, reason: `Auto-fill service error: ${msg}. Enter the details manually.` };
  }

  if (!fields) {
    return { ok: false, reason: "Couldn't read the card automatically. Enter the details manually." };
  }

  // If the model genuinely read nothing, log the raw shape once for diagnosis.
  if (!fields.fullName && !fields.eidNumber && !fields.nationality) {
    console.warn("[eid-ocr] model returned no usable fields:", JSON.stringify(fields));
  }

  return { ok: true, fields };
}

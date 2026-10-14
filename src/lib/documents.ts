import type { DocumentType } from "@prisma/client";

// Document slot metadata (spec §4). The 4 expiry-bearing docs sync their expiry
// back to the matching Staff column so the list/engine stay consistent.
type StaffExpiryField = "eidExpiry" | "ohcExpiry" | "bfhcExpiry" | "passportExpiry" | "visaExpiry";

export const DOC_TYPE_META: Record<
  DocumentType,
  { label: string; hasExpiry: boolean; staffExpiryField?: StaffExpiryField }
> = {
  EID_FRONT: { label: "Emirates ID — Front", hasExpiry: true, staffExpiryField: "eidExpiry" },
  EID_BACK: { label: "Emirates ID — Back", hasExpiry: true, staffExpiryField: "eidExpiry" },
  PASSPORT: { label: "Passport", hasExpiry: true, staffExpiryField: "passportExpiry" },
  VISA: { label: "Residence Visa", hasExpiry: true, staffExpiryField: "visaExpiry" },
  OHC: { label: "Occupational Health Card", hasExpiry: true, staffExpiryField: "ohcExpiry" },
  BFHC: { label: "Basic Food Hygiene Certificate", hasExpiry: true, staffExpiryField: "bfhcExpiry" },
  SHORT_TERM_AGREEMENT: { label: "Short-term Agreement", hasExpiry: true },
  BANK_PROOF: { label: "Bank Proof (IBAN letter)", hasExpiry: false },
  PHOTO: { label: "Staff Photo", hasExpiry: false },
  NOC: { label: "NOC (No-Objection Certificate)", hasExpiry: true },
};

// Order of the slots shown in the profile gallery. PHOTO is rendered next to the
// name (not a card); EID_BACK is intentionally excluded from the gallery slots.
export const DOC_SLOTS: DocumentType[] = [
  "EID_FRONT", "PASSPORT", "VISA", "OHC", "BFHC", "NOC", "SHORT_TERM_AGREEMENT", "BANK_PROOF",
];

// What an upload may be. Deliberately broad: HR receives whatever the employee or the
// typing centre sends — a phone photo, a scan, a Word letter, a zipped set. Images and
// PDFs are shrunk on the server (lib/optimize.ts); anything else is stored as it is.
// An empty `accept` would be simpler still, but naming the common types makes the file
// chooser default to documents instead of every file on the machine.
export const ACCEPTED_MIME = [
  "image/*", "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv", "application/rtf",
  "application/zip", "application/x-rar-compressed", "application/x-7z-compressed",
];

// `accept` attribute + a human-readable hint for document upload inputs.
export const DOC_ACCEPT_ATTR = [...ACCEPTED_MIME, ".heic", ".heif", ".doc", ".docx", ".xls", ".xlsx", ".rar", ".7z"].join(",");
export const DOC_ACCEPT_HINT = "any photo, scan or document — JPG, PNG, HEIC, PDF, Word, Excel, ZIP. Large photos are shrunk automatically";
// EID auto-fill / photo need a real image (no PDF/HEIC through vision).
export const IMAGE_ACCEPT_ATTR = "image/jpeg,image/png,image/webp";
export const IMAGE_ACCEPT_HINT = "JPG, PNG or WEBP";

export function extForMime(mime: string, fallbackName = ""): string {
  const m: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "image/tiff": ".tiff", "image/bmp": ".bmp",
    "image/heic": ".heic", "image/heif": ".heif", "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt", "text/csv": ".csv", "application/rtf": ".rtf", "application/zip": ".zip",
  };
  if (m[mime]) return m[mime];
  const ext = fallbackName.includes(".") ? fallbackName.slice(fallbackName.lastIndexOf(".")) : ".bin";
  return ext.toLowerCase();
}

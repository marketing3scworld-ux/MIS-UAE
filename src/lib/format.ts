const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Dates are stored as UTC-midnight; format from UTC parts to avoid tz shifting.
export function formatDateUTC(d: Date | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return `${String(x.getUTCDate()).padStart(2, "0")} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

// Staff names are stored ALL-CAPS from the source data; present them Title Cased
// for display: "MOHAMMED AL-FARSI" -> "Mohammed Al-Farsi", "O'BRIEN" -> "O'Brien".
// Lowercases everything, then re-capitalises the first letter of each word,
// respecting the usual name separators (space, hyphen, apostrophe, slash, dot).
export function titleCaseName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'/.(])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

// Common name/label particles that read lower/title-cased even when the source
// is ALL-CAPS (so "AL DAITH" -> "Al Daith", not "AL Daith").
const LABEL_PARTICLES = new Set([
  "al", "el", "de", "del", "la", "le", "da", "di", "van", "von", "bin", "of", "the", "and",
]);

// Site / document / bank codes that must stay upper-case. This is an explicit list
// on purpose: the old rule kept ANY 2-4 letter all-caps token as-is, which is why
// the dropdowns showed "CHEF", "COOK", "HOST", "SKY VIEW" and "GULF FOOD" shouting
// among properly-cased entries. Add new site codes here as they appear.
const LABEL_ACRONYMS = new Set([
  "ATR", "ATP", "JCH", "JRCC", "RAK", "MO", // service locations
  "FOH", "BOH", // categories
  "EID", "OHC", "BFHC", "NOC", // documents
  "ADCB", "NBD", "PJSC", "IBAN", // banking
  "UAE", "KSA", "HR", "VIP",
]);

// Title-case a category / location / free label from ALL-CAPS source, but PRESERVE
// known acronyms so codes stay intact:
//   "HOUSEKEEPING" -> "Housekeeping", "COMMIS/FOH" -> "Commis/FOH",
//   "AL DAITH" -> "Al Daith", "MANDARIN ORIENTAL DOWNTOWN" -> "Mandarin Oriental Downtown",
//   "ATR" -> "ATR", "JRCC" -> "JRCC", "CHEF" -> "Chef", "GULF FOOD" -> "Gulf Food".
export function titleCaseLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/(\s+|\/|-)/) // keep the separators (space, slash, hyphen)
    .map((tok) => {
      if (tok === "" || /^(\s+|\/|-)$/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      if (LABEL_ACRONYMS.has(tok.toUpperCase()) && !LABEL_PARTICLES.has(lower)) return tok.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

// yyyy-mm-dd for <input type="date"> values.
export function toDateInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

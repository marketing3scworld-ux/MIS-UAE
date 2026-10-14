// Bulk-import existing document scans from data/ into the system (spec §4 storage).
//
//   npm run import:docs -- [<dir>] [--wipe]
//
// <dir> defaults to data/. Pass a subfolder (e.g. "data/new-84") to import ONLY
// that batch without re-scanning already-imported scans.
//
// Structure: one folder per staff (named by full name), sometimes nested inside
// grouping folders, plus some loose files. Files name the document TYPE
// inconsistently (NAME-EID.png, "NAME EID FRONT.jpeg", bare OHC.jpeg / PP.png…).
//
// SAFETY: staff are matched ONLY by exact normalized name (folder basename, or the
// file-name prefix after stripping the type keyword). No fuzzy matching — these are
// Emirates IDs / passports; a wrong attach is worse than an unattached file, which
// is logged for manual review.

import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient, DocumentType, DocHandlingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const dirArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const DATA_DIR = path.resolve(dirArg || "data");
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || "./uploads");

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".pdf": "application/pdf",
};
const TYPE_TOKENS = ["EID", "FRONT", "BACK", "OHC", "BFHC", "BFH", "PASSPORT", "PP", "NOC", "VISA", "PHOTO", "2X2", "BANK", "IBAN", "AGREEMENT", "CONTRACT", "STA"];

function normName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function stripTypeTokens(norm: string): string {
  return norm.split(" ").filter((t) => t && !TYPE_TOKENS.includes(t)).join(" ").trim();
}
function detectType(fileName: string): DocumentType | "DEFERRED" | null {
  const u = ` ${fileName.toUpperCase().replace(/[._\-()]/g, " ").replace(/\s+/g, " ")} `;
  if (/\bNOC\b/.test(u) || /\bPHOTO\b/.test(u) || /\b2X2\b/.test(u)) return "DEFERRED";
  if (/\bVISA\b/.test(u)) return DocumentType.VISA;
  if (/\bAGREEMENT\b/.test(u) || /\bCONTRACT\b/.test(u)) return DocumentType.SHORT_TERM_AGREEMENT;
  if (/\bBFHC\b/.test(u) || /\bBFH\b/.test(u)) return DocumentType.BFHC;
  if (/\bOHC\b/.test(u)) return DocumentType.OHC;
  if (/\bEID\b.*\bBACK\b/.test(u) || /\bBACK\b/.test(u)) return DocumentType.EID_BACK;
  if (/\bEID\b.*\bFRONT\b/.test(u) || /\bFRONT\b/.test(u)) return DocumentType.EID_FRONT;
  if (/\bEID\b/.test(u)) return DocumentType.EID_FRONT;
  if (/\bPASSPORT\b/.test(u) || /\bPP\b/.test(u)) return DocumentType.PASSPORT;
  if (/\bBANK\b/.test(u) || /\bIBAN\b/.test(u)) return DocumentType.BANK_PROOF;
  return null;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function main() {
  const wipe = process.argv.includes("--wipe");

  // Build exact-name -> staffId map; flag ambiguous (duplicate) names.
  const staff = await prisma.staff.findMany({ select: { id: true, fullName: true } });
  const byName = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const s of staff) {
    const n = normName(s.fullName);
    if (byName.has(n)) ambiguous.add(n);
    else byName.set(n, s.id);
  }

  if (wipe) {
    console.log("--wipe: clearing StaffDocument rows + uploads/staff …");
    await prisma.staffDocument.deleteMany({});
    await fs.rm(path.join(UPLOAD_ROOT, "staff"), { recursive: true, force: true });
  }

  const report: string[] = ["status,type,staffId,ownerHint,file"];
  const counts = { attached: 0, deferred: 0, junk: 0, unknownType: 0, unmatched: 0, ambiguous: 0 };
  const byType: Record<string, number> = {};
  const unmatchedNames = new Map<string, number>();
  const current = new Map<string, { id: number; version: number }>();
  const staffWithDocs = new Set<number>();

  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

  for await (const file of walk(DATA_DIR)) {
    const base = path.basename(file);
    const ext = path.extname(file).toLowerCase();
    if (base.toLowerCase() === ".gitkeep") continue;
    if (!MIME[ext]) { counts.junk++; continue; } // .ini, .xlsx, .doc, etc.

    const type = detectType(base);
    if (type === "DEFERRED") { counts.deferred++; report.push(["DEFERRED", "", "", "", esc(base)].join(",")); continue; }
    if (type === null) { counts.unknownType++; report.push(["UNKNOWN_TYPE", "", "", "", esc(base)].join(",")); continue; }

    // Resolve owner: folder basename first, then file-name prefix.
    const folder = path.basename(path.dirname(file));
    let hint = folder;
    let key = stripTypeTokens(normName(folder));
    let staffId = byName.get(key);
    if (!staffId) {
      const fromFile = stripTypeTokens(normName(path.basename(base, ext)));
      if (byName.get(fromFile)) { staffId = byName.get(fromFile); hint = path.basename(base, ext); key = fromFile; }
    }

    if (!staffId) {
      if (ambiguous.has(key)) { counts.ambiguous++; report.push(["AMBIGUOUS", type, "", esc(hint), esc(base)].join(",")); }
      else { counts.unmatched++; unmatchedNames.set(hint, (unmatchedNames.get(hint) ?? 0) + 1); report.push(["UNMATCHED", type, "", esc(hint), esc(base)].join(",")); }
      continue;
    }

    // Copy into uploads and create the record (versioning any prior of same type).
    const dir = path.join(UPLOAD_ROOT, "staff", String(staffId), type.toLowerCase());
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${randomUUID()}${ext}`);
    await fs.copyFile(file, dest);
    const size = (await fs.stat(dest)).size;
    const relPath = path.relative(UPLOAD_ROOT, dest).split(path.sep).join("/");

    const ck = `${staffId}|${type}`;
    const prev = current.get(ck);
    if (prev) await prisma.staffDocument.update({ where: { id: prev.id }, data: { isCurrent: false } });
    const created = await prisma.staffDocument.create({
      data: {
        staffId, type, filePath: relPath, fileName: base, mimeType: MIME[ext], fileSize: size,
        expiryDate: null, handlingStatus: DocHandlingStatus.SUBMITTED,
        version: prev ? prev.version + 1 : 1, isCurrent: true,
      },
    });
    current.set(ck, { id: created.id, version: prev ? prev.version + 1 : 1 });
    counts.attached++;
    byType[type] = (byType[type] ?? 0) + 1;
    staffWithDocs.add(staffId);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.resolve("import-reports");
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, `docs-import-${stamp}.csv`);
  await fs.writeFile(reportPath, report.join("\n"), "utf8");

  const topUnmatched = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  console.log("\n============ DOCUMENT IMPORT REPORT ============");
  console.log(`Attached documents : ${counts.attached}  (${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")})`);
  console.log(`Staff with >=1 doc : ${staffWithDocs.size} / ${staff.length}`);
  console.log(`Deferred (NOC/VISA/PHOTO) skipped : ${counts.deferred}`);
  console.log(`Junk/non-doc skipped              : ${counts.junk}`);
  console.log(`Unknown-type skipped              : ${counts.unknownType}`);
  console.log(`Unmatched (no exact staff)        : ${counts.unmatched}  across ${unmatchedNames.size} names`);
  console.log(`Ambiguous (duplicate staff name)  : ${counts.ambiguous}`);
  console.log(`\nTop unmatched folder/file names (review + rename to match master list):`);
  for (const [name, n] of topUnmatched) console.log(`   ${n.toString().padStart(3)}  ${name}`);
  console.log(`\nFull report: ${reportPath}`);
  console.log("===============================================\n");
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error("DOC IMPORT FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});

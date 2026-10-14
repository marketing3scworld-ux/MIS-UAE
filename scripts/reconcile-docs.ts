// Reconcile document folders whose NAME doesn't match a staff record, by bridging
// through the Excel's EID. For each folder in <dir> whose normalized name isn't a
// staff name, we look up its EID from <xlsx> (name -> EID), find the staff with
// that EID, correct that staff's stored name to the Excel spelling, and attach the
// folder's documents. Folders that already match a staff by name are skipped
// (they were handled by `import:docs`).
//
//   npm run reconcile:docs -- "data/ACTIVE STAFFS" "data/<complete documents>.xlsx"
//   (add --apply to perform it; without it, prints what it WOULD do)

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

const APPLY = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DIR = path.resolve(args[0] ?? "data/ACTIVE STAFFS");
const XLSX = path.resolve(args[1] ?? "");

// User-confirmed manual bridges (normalized folder name -> EID) for folders whose
// spelling matched neither the DB nor the Excel. Attaches by EID; does not rename.
const OVERRIDES: Record<string, string> = {
  "GINALYN MADANI MANAGKI": "784-1976-6174982-6",
  "GLORIA AMA BOATENG": "784-1997-2916533-4",
  "HAYAT KHAN GUL": "784-1998-7366896-8",
  "MARGARET WANJIKU KARIUKI": "784-1996-5424724-8",
  "RIAZ HOSSAN SHA ALAM": "784-1992-5224440-7",
  "ZABER HOSSAIN": "784-1977-2931892-9",
};

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) {
    const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
    if (m) return m[1];
  }
  return fallback;
}
const DATABASE_URL = fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;
const UPLOAD_ROOT = path.resolve(fromEnv("UPLOAD_DIR", "./uploads"));

// eslint-disable-next-line import/first
import { PrismaClient, DocumentType, DocHandlingStatus } from "@prisma/client";
const prisma = new PrismaClient();

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".pdf": "application/pdf",
};
const TYPE_TOKENS = ["EID", "FRONT", "BACK", "OHC", "BFHC", "BFH", "PASSPORT", "PP", "NOC", "VISA", "PHOTO", "2X2", "BANK", "IBAN", "AGREEMENT", "CONTRACT", "STA"];
const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function detectType(fileName: string): DocumentType | null {
  const u = ` ${fileName.toUpperCase().replace(/[._\-()]/g, " ").replace(/\s+/g, " ")} `;
  if (/\bNOC\b/.test(u) || /\bPHOTO\b/.test(u) || /\b2X2\b/.test(u)) return null;
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
function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellStr(o.result);
    if ("text" in o) return cellStr(o.text);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

async function excelNameToEid(file: string): Promise<Map<string, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let nameCol = 0, eidCol = 0;
  ws.getRow(1).eachCell((c, col) => {
    const h = cellStr(c.value).toUpperCase();
    if (h.includes("FULL NAME")) nameCol = col;
    else if (h.includes("EID NUMBER")) eidCol = col;
  });
  const map = new Map<string, string>();
  if (!nameCol || !eidCol) return map;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nm = cellStr(row.getCell(nameCol).value);
    const eid = cellStr(row.getCell(eidCol).value);
    if (nm && eid) map.set(normName(nm), eid);
  }
  return map;
}

async function main() {
  if (!existsSync(DIR)) throw new Error(`folder not found: ${DIR}`);
  if (!XLSX || !existsSync(XLSX)) throw new Error(`Excel not found: ${XLSX}`);

  const excelMap = await excelNameToEid(XLSX);
  const staff = await prisma.staff.findMany({ select: { id: true, fullName: true, eidNumber: true } });
  const nameSet = new Set(staff.map((s) => normName(s.fullName)));
  const eidToId = new Map(staff.filter((s) => s.eidNumber).map((s) => [s.eidNumber as string, s.id]));

  const subdirs = (await fsp.readdir(DIR, { withFileTypes: true })).filter((e) => e.isDirectory());
  const renamed = 0;
  let attached = 0, unresolved = 0;
  const byType: Record<string, number> = {};

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — reconciling by EID\n`);

  for (const d of subdirs) {
    const fn = normName(d.name);
    if (nameSet.has(fn)) continue; // already matched by name (handled by import:docs)

    const eid = excelMap.get(fn) ?? OVERRIDES[fn];
    const staffId = eid ? eidToId.get(eid) : undefined;
    if (!staffId) {
      unresolved++;
      // Suggest the closest existing staff by shared name tokens (for review only).
      const toks = fn.split(" ").filter(Boolean);
      let best: (typeof staff)[number] | null = null, bestScore = 0;
      for (const s of staff) {
        const st = new Set(normName(s.fullName).split(" ").filter(Boolean));
        const shared = toks.filter((t) => st.has(t)).length;
        if (shared > bestScore) { bestScore = shared; best = s; }
      }
      const hint = best && bestScore >= 2 ? `  ~ maybe #${best.id} "${best.fullName}" (EID ${best.eidNumber ?? "—"}, ${bestScore} shared tokens)` : "  (no close match)";
      console.log(`  UNRESOLVED  "${d.name}"  ${eid ? `(EID ${eid} not in DB)` : "(not in Excel)"}${hint}`);
      continue;
    }

    const dbName = staff.find((s) => s.id === staffId)!.fullName;
    console.log(`  "${d.name}"  ->  #${staffId} "${dbName}"`);

    const files = (await fsp.readdir(path.join(DIR, d.name), { withFileTypes: true })).filter((f) => f.isFile());
    const current = new Map<string, { id: number; version: number }>();
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (!MIME[ext]) continue;
      const type = detectType(f.name);
      if (!type) continue;
      if (!APPLY) { attached++; byType[type] = (byType[type] ?? 0) + 1; continue; }

      const src = path.join(DIR, d.name, f.name);
      const destDir = path.join(UPLOAD_ROOT, "staff", String(staffId), type.toLowerCase());
      await fsp.mkdir(destDir, { recursive: true });
      const dest = path.join(destDir, `${randomUUID()}${ext}`);
      await fsp.copyFile(src, dest);
      const size = (await fsp.stat(dest)).size;
      const relPath = path.relative(UPLOAD_ROOT, dest).split(path.sep).join("/");

      const prev = current.get(type) ?? (await prisma.staffDocument.findFirst({ where: { staffId, type, isCurrent: true }, select: { id: true, version: true } })) ?? undefined;
      if (prev) await prisma.staffDocument.update({ where: { id: prev.id }, data: { isCurrent: false } });
      const created = await prisma.staffDocument.create({
        data: {
          staffId, type, filePath: relPath, fileName: f.name, mimeType: MIME[ext], fileSize: size,
          expiryDate: null, handlingStatus: DocHandlingStatus.SUBMITTED,
          version: prev ? prev.version + 1 : 1, isCurrent: true,
        },
      });
      current.set(type, { id: created.id, version: prev ? prev.version + 1 : 1 });
      attached++; byType[type] = (byType[type] ?? 0) + 1;
    }
  }

  console.log(`\n──────── ${APPLY ? "DONE" : "DRY RUN"} ────────`);
  console.log(`  names corrected   ${renamed}`);
  console.log(`  docs ${APPLY ? "attached" : "to attach"}   ${attached}  (${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")})`);
  console.log(`  unresolved folders ${unresolved}`);
  if (!APPLY) console.log(`\n  Re-run with --apply to perform it.`);
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

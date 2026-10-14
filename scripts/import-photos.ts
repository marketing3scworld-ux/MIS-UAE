// Import staff PHOTOS from the ACTIVE STAFFS folders. Each folder may contain a
// headshot (PHOTO / 2X2 / PIC named, or a bare-name image) mixed in with document
// scans and the odd screenshot. We pick candidate images (excluding anything that
// looks like a document), VERIFY each with Claude vision (is it a portrait of a
// person, not a document), then optimise + attach the first confirmed one as the
// staff PHOTO (the avatar). One photo per staff; skips staff who already have one.
//
//   npm run import:photos -- "data/ACTIVE STAFFS"            # DRY RUN (classifies + reports, writes nothing)
//   npm run import:photos -- "data/ACTIVE STAFFS" --apply    # also attaches
//   PHOTO_MODEL overrides the vision model (default claude-sonnet-5).

import path from "node:path";
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const DIR = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "data/ACTIVE STAFFS");

function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const p = path.resolve(".env");
  if (existsSync(p)) { const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m")); if (m) return m[1]; }
  return fallback;
}
const DATABASE_URL = fromEnv("DATABASE_URL");
const API_KEY = fromEnv("ANTHROPIC_API_KEY");
if (!DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
if (!API_KEY) { console.error("ANTHROPIC_API_KEY not found"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;
const UPLOAD_ROOT = path.resolve(fromEnv("UPLOAD_DIR", "./uploads"));
const MODEL = process.env.PHOTO_MODEL || "claude-sonnet-5";

// eslint-disable-next-line import/first
import { PrismaClient, DocumentType, DocHandlingStatus } from "@prisma/client";
const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: API_KEY });

const IMG = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Confirmed folder -> correct staff name (spelling variants), incl. the earlier 6 + ALFAJ.
const NAME_OVERRIDES: Record<string, string> = {
  "GINALYN MADANI MANAGKI": "GINALYN MADANI MANANGKI",
  "GLORIA AMA BOATENG": "GLORIA BOATENG",
  "HAYAT KHAN GUL": "HAYAT KHAN KHAN GUL",
  "MARGARET WANJIKU KARIUKI": "MARGARET WANJIKU KARIUKE",
  "RIAZ HOSSAN SHA ALAM": "RIAZ HOSSAIN SHAH ALAM",
  "ZABER HOSSAIN": "ZABER HOSSAIN ABDUL RASHID",
  "ALFAJ MIA": "ALFAJ MIAH",
};

// A filename that clearly denotes a DOCUMENT (never a headshot). Includes common typos.
function isDocName(n: string): boolean {
  const u = ` ${n.toUpperCase().replace(/[._\-()]/g, " ").replace(/\s+/g, " ")} `;
  return /\bEID\b|\bEIDD\b|\bOHC\b|\bBFHC\b|\bBFH\b|\bBHFH\b|\bPASSPORT\b|\bPP\b|\bPASS\b|\bVISA\b|\bNOC\b|\bBANK\b|\bIBAN\b|\bID CARD\b/.test(u)
    || /\bBME\b/.test(u); // "bme id" company card
}
const photoScore = (n: string) => (/\b(PHOTO|2X2|PIC|PICTURE|HEADSHOT)\b/.test(` ${n.toUpperCase().replace(/[._\-()]/g, " ")} `) ? 0 : 1);

async function isPortrait(buf: Buffer): Promise<boolean | null> {
  let jpeg: Buffer;
  try {
    jpeg = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch { return null; } // unreadable (e.g. HEIC without codec)
  try {
    const res = await anthropic.messages.create({
      model: MODEL, max_tokens: 5,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
        { type: "text", text: "Answer with ONLY 'YES' or 'NO'. Is this a portrait / passport-style headshot photograph of a single real person's face (a staff photo) — and NOT a document, ID card, certificate, passport page, visa, or screenshot of text?" },
      ] }],
    });
    const t = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").toUpperCase();
    return /\bYES\b/.test(t);
  } catch (e) {
    console.log(`    ! vision error: ${(e as Error).message}`);
    return null;
  }
}

async function optimizePhoto(buf: Buffer): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  try {
    const out = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    return { buffer: out, ext: ".webp", mime: "image/webp" };
  } catch {
    return { buffer: buf, ext: ".jpg", mime: "image/jpeg" };
  }
}

async function main() {
  const staff = await prisma.staff.findMany({ select: { id: true, fullName: true } });
  const nameToId = new Map<string, number>();
  for (const s of staff) { const n = normName(s.fullName); if (!nameToId.has(n)) nameToId.set(n, s.id); }
  const resolve = (folder: string): number | undefined => {
    const fn = normName(folder);
    return nameToId.get(fn) ?? (NAME_OVERRIDES[fn] ? nameToId.get(normName(NAME_OVERRIDES[fn])) : undefined);
  };

  const subdirs = (await fsp.readdir(DIR, { withFileTypes: true })).filter((e) => e.isDirectory());
  let attached = 0, already = 0, noPortrait = 0, unmatched = 0;
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} · model=${MODEL} · folders=${subdirs.length}\n`);

  for (const d of subdirs) {
    const staffId = resolve(d.name);
    if (!staffId) { unmatched++; console.log(`  UNMATCHED  "${d.name}"`); continue; }

    if (!FORCE) {
      const existing = await prisma.staffDocument.findFirst({ where: { staffId, type: DocumentType.PHOTO, isCurrent: true }, select: { id: true } });
      if (existing) { already++; continue; }
    }

    const files = (await fsp.readdir(path.join(DIR, d.name), { withFileTypes: true }))
      .filter((f) => f.isFile() && IMG.has(path.extname(f.name).toLowerCase()) && !isDocName(f.name))
      .sort((a, b) => photoScore(a.name) - photoScore(b.name));

    let done = false;
    for (const f of files.slice(0, 3)) { // cap candidates per folder
      const buf = await fsp.readFile(path.join(DIR, d.name, f.name));
      const verdict = await isPortrait(buf);
      if (verdict !== true) continue;
      console.log(`  ${d.name}  ->  #${staffId}  photo: "${f.name}"`);
      if (APPLY) {
        const opt = await optimizePhoto(buf);
        const dir = path.join(UPLOAD_ROOT, "staff", String(staffId), "photo");
        await fsp.mkdir(dir, { recursive: true });
        const abs = path.join(dir, `${randomUUID()}${opt.ext}`);
        await fsp.writeFile(abs, opt.buffer);
        const relPath = path.relative(UPLOAD_ROOT, abs).split(path.sep).join("/");
        const prev = await prisma.staffDocument.findFirst({ where: { staffId, type: DocumentType.PHOTO, isCurrent: true }, select: { id: true, version: true } });
        if (prev) await prisma.staffDocument.update({ where: { id: prev.id }, data: { isCurrent: false } });
        await prisma.staffDocument.create({ data: {
          staffId, type: DocumentType.PHOTO, filePath: relPath, fileName: f.name, mimeType: opt.mime, fileSize: opt.buffer.length,
          expiryDate: null, handlingStatus: DocHandlingStatus.SUBMITTED, version: prev ? prev.version + 1 : 1, isCurrent: true,
        } });
      }
      attached++; done = true; break;
    }
    if (!done) { noPortrait++; console.log(`  NO PHOTO   "${d.name}"  (no candidate verified as a portrait)`); }
  }

  console.log(`\n──────── ${APPLY ? "DONE" : "DRY RUN"} ────────`);
  console.log(`  photos ${APPLY ? "attached" : "to attach"}   ${attached}`);
  console.log(`  already had a photo    ${already}`);
  console.log(`  no portrait found      ${noPortrait}`);
  console.log(`  unmatched folders      ${unmatched}`);
  if (!APPLY) console.log(`\n  Re-run with --apply to attach them.`);
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

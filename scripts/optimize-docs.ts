// One-time backfill: compress documents ALREADY stored on disk.
//
//   npm run optimize:docs             # DRY RUN — reports projected savings, changes nothing
//   npm run optimize:docs -- --apply  # actually re-encode, update the DB, free the old files
//
// Images  -> re-encoded to WebP (auto-oriented, <=2200px, q78) via sharp.
// PDFs    -> re-compressed via Ghostscript (-dPDFSETTINGS=/ebook, 150dpi) IF gs
//            is available. Set GS_BIN to the full path of gswin64c.exe if it isn't
//            auto-found. Without gs, PDFs are simply skipped.
//
// For every file the new version is kept ONLY if it is smaller, and the safe order
// is: 1) write new  2) update the row  3) delete the old file — so an interruption
// never loses a document. Writes a CSV report to import-reports/.

import { promises as fs } from "node:fs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

// ── config ──
const MAX_EDGE = 2200;
const WEBP_QUALITY = 78;
const PDF_SETTING = "/ebook"; // Ghostscript preset: /screen(72dpi) /ebook(150) /printer(300)
const IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif",
]);
const APPLY = process.argv.includes("--apply");

// ── env (tsx doesn't auto-load .env) ──
function fromEnv(key: string, fallback = ""): string {
  if (process.env[key]) return process.env[key] as string;
  const envPath = path.resolve(".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"));
    if (m) return m[1];
  }
  return fallback;
}
const DATABASE_URL = fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("DATABASE_URL not found in env or .env"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;
const ROOT = path.resolve(fromEnv("UPLOAD_DIR", "./uploads"));
const TMP = path.join(ROOT, "_optimize_tmp");

// eslint-disable-next-line import/first
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ── locate Ghostscript (PATH, GS_BIN, or a versioned install on D:/C:) ──
function gsRuns(bin: string): boolean {
  try { return spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
}
function resolveGs(): string | null {
  const envBin = process.env.GS_BIN;
  if (envBin && existsSync(envBin) && gsRuns(envBin)) return envBin;
  if (gsRuns("gswin64c")) return "gswin64c";
  for (const base of ["D:\\gs", "C:\\Program Files\\gs", "C:\\Program Files (x86)\\gs"]) {
    try {
      for (const d of readdirSync(base)) {
        const p = path.join(base, d, "bin", "gswin64c.exe");
        if (existsSync(p) && gsRuns(p)) return p;
      }
    } catch { /* base doesn't exist */ }
  }
  return null;
}
const GS = resolveGs();

// ── helpers ──
function resolveInside(rel: string): string {
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error("path outside upload root");
  return abs;
}
function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
function isImage(mime: string, ...names: string[]): boolean {
  if (IMAGE_MIMES.has((mime || "").toLowerCase())) return true;
  return names.some((n) => /\.(jpe?g|png|webp|gif|tiff?|heic|heif)$/i.test(n || ""));
}
function isPdf(mime: string, ...names: string[]): boolean {
  if ((mime || "").toLowerCase() === "application/pdf") return true;
  return names.some((n) => /\.pdf$/i.test(n || ""));
}
async function toWebp(input: Buffer): Promise<Buffer | null> {
  try {
    const out = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return out.length < input.length ? out : null;
  } catch { return null; }
}
// Compress a PDF to a temp file; returns its path if it's smaller, else null.
async function compressPdf(inAbs: string, origSize: number): Promise<{ tmp: string; size: number } | null> {
  if (!GS) return null;
  await fs.mkdir(TMP, { recursive: true });
  const tmp = path.join(TMP, `${randomUUID()}.pdf`);
  const r = spawnSync(GS, [
    "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", `-dPDFSETTINGS=${PDF_SETTING}`,
    "-dDetectDuplicateImages=true", "-dCompressFonts=true",
    "-dNOPAUSE", "-dQUIET", "-dBATCH", `-sOutputFile=${tmp}`, inAbs,
  ], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(tmp)) { try { await fs.rm(tmp, { force: true }); } catch {} return null; }
  const size = (await fs.stat(tmp)).size;
  if (size >= origSize) { try { await fs.rm(tmp, { force: true }); } catch {} return null; }
  return { tmp, size };
}
async function saveBuffer(staffId: number, type: string, ext: string, buf: Buffer): Promise<{ relPath: string; size: number }> {
  const dir = path.join(ROOT, "staff", String(staffId), type.toLowerCase());
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, `${randomUUID()}${ext}`);
  await fs.writeFile(abs, buf);
  return { relPath: path.relative(ROOT, abs).split(path.sep).join("/"), size: buf.length };
}
async function commitTmp(staffId: number, type: string, ext: string, tmpAbs: string): Promise<{ relPath: string; size: number }> {
  const dir = path.join(ROOT, "staff", String(staffId), type.toLowerCase());
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, `${randomUUID()}${ext}`);
  await fs.rename(tmpAbs, abs);
  return { relPath: path.relative(ROOT, abs).split(path.sep).join("/"), size: (await fs.stat(abs)).size };
}
const mb = (n: number) => (n / 1_048_576).toFixed(1) + " MB";

async function main() {
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} · uploads: ${ROOT}`);
  console.log(`Ghostscript: ${GS ?? "NOT FOUND — PDFs will be skipped (set GS_BIN or install Ghostscript)"}\n`);

  const docs = await prisma.staffDocument.findMany({
    select: { id: true, staffId: true, type: true, filePath: true, fileName: true, mimeType: true, fileSize: true },
    orderBy: { id: "asc" },
  });

  const report: string[] = ["docId,staffId,type,kind,status,oldBytes,newBytes,savedBytes"];
  let scanned = 0, imgDone = 0, pdfDone = 0, skippedOther = 0, skippedWebp = 0, noGain = 0, missing = 0, errors = 0;
  let imgBefore = 0, imgAfter = 0, pdfBefore = 0, pdfAfter = 0;

  for (const d of docs) {
    scanned++;
    const rawImg = isImage(d.mimeType, d.fileName, d.filePath);
    // Already-WebP files are treated as optimized — re-encoding them would just
    // re-apply lossy compression (generation loss) for a negligible gain.
    const alreadyWebp = (d.mimeType || "").toLowerCase() === "image/webp"
      || /\.webp$/i.test(d.filePath) || /\.webp$/i.test(d.fileName);
    const image = rawImg && !alreadyWebp;
    const pdf = !rawImg && isPdf(d.mimeType, d.fileName, d.filePath);
    if (!image && !pdf) { if (rawImg && alreadyWebp) skippedWebp++; else skippedOther++; continue; }

    let inAbs: string;
    try { inAbs = resolveInside(d.filePath); } catch { missing++; continue; }
    if (!existsSync(inAbs)) {
      missing++;
      report.push(`${d.id},${d.staffId},${d.type},${image ? "image" : "pdf"},missing-file,${d.fileSize},,`);
      continue;
    }
    const origSize = (await fs.stat(inAbs)).size;

    // ── images ──
    if (image) {
      const raw = await fs.readFile(inAbs);
      const webp = await toWebp(raw);
      if (!webp) { noGain++; continue; }
      imgBefore += raw.length; imgAfter += webp.length; imgDone++;
      report.push(`${d.id},${d.staffId},${d.type},image,${APPLY ? "optimized" : "would-optimize"},${raw.length},${webp.length},${raw.length - webp.length}`);
      if (APPLY) {
        try {
          const oldPath = d.filePath;
          const stored = await saveBuffer(d.staffId, String(d.type), ".webp", webp);
          await prisma.staffDocument.update({
            where: { id: d.id },
            data: { filePath: stored.relPath, fileName: `${baseName(d.fileName)}.webp`, mimeType: "image/webp", fileSize: stored.size },
          });
          if (oldPath !== stored.relPath) { try { await fs.rm(resolveInside(oldPath), { force: true }); } catch {} }
        } catch (e) { errors++; console.error(`  ! doc ${d.id}: ${(e as Error).message}`); }
      }
      if ((imgDone + pdfDone) % 50 === 0) console.log(`  …${imgDone + pdfDone} files processed`);
      continue;
    }

    // ── pdfs ──
    if (!GS) { skippedOther++; continue; }
    const res = await compressPdf(inAbs, origSize);
    if (!res) { noGain++; continue; }
    pdfBefore += origSize; pdfAfter += res.size; pdfDone++;
    report.push(`${d.id},${d.staffId},${d.type},pdf,${APPLY ? "optimized" : "would-optimize"},${origSize},${res.size},${origSize - res.size}`);
    if (APPLY) {
      try {
        const oldPath = d.filePath;
        const stored = await commitTmp(d.staffId, String(d.type), ".pdf", res.tmp);
        await prisma.staffDocument.update({
          where: { id: d.id },
          data: { filePath: stored.relPath, fileSize: stored.size },
        });
        if (oldPath !== stored.relPath) { try { await fs.rm(resolveInside(oldPath), { force: true }); } catch {} }
      } catch (e) { errors++; console.error(`  ! doc ${d.id}: ${(e as Error).message}`); }
    } else {
      try { await fs.rm(res.tmp, { force: true }); } catch {}
    }
    if ((imgDone + pdfDone) % 50 === 0) console.log(`  …${imgDone + pdfDone} files processed`);
  }

  try { await fs.rm(TMP, { recursive: true, force: true }); } catch {}

  const dir = path.resolve("import-reports");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportFile = path.join(dir, `optimize-docs-${stamp}.csv`);
  await fs.writeFile(reportFile, report.join("\n"), "utf8");

  const totBefore = imgBefore + pdfBefore, totAfter = imgAfter + pdfAfter;
  const pct = (a: number, b: number) => (a ? Math.round(((a - b) / a) * 100) : 0);
  console.log(`\n──────── ${APPLY ? "DONE" : "DRY RUN — nothing changed"} ────────`);
  console.log(`  documents scanned      ${scanned}`);
  console.log(`  images  ${APPLY ? "optimized" : "to do"}        ${imgDone}   ${mb(imgBefore)} -> ${mb(imgAfter)}  (${pct(imgBefore, imgAfter)}%)`);
  console.log(`  pdfs    ${APPLY ? "optimized" : "to do"}        ${pdfDone}   ${mb(pdfBefore)} -> ${mb(pdfAfter)}  (${pct(pdfBefore, pdfAfter)}%)`);
  console.log(`  skipped (already webp) ${skippedWebp}`);
  console.log(`  skipped (no gain)      ${noGain}`);
  console.log(`  skipped (other/no gs)  ${skippedOther}`);
  console.log(`  missing on disk        ${missing}`);
  if (errors) console.log(`  errors                 ${errors}`);
  console.log(`  TOTAL                  ${mb(totBefore)} -> ${mb(totAfter)}   (saved ${mb(totBefore - totAfter)}, ${pct(totBefore, totAfter)}%)`);
  console.log(`  report                 ${path.relative(process.cwd(), reportFile)}`);
  if (!APPLY && (imgDone + pdfDone)) console.log(`\n  Re-run with --apply to perform it:  npm run optimize:docs -- --apply`);
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

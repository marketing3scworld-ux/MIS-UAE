// Document optimisation (server-only). Uploaded document photos are typically
// 4–10 MB phone captures; storing them raw would bloat the server. We downscale
// and re-encode images to WebP before they hit disk, WITHOUT imposing any
// user-facing size limit — the user uploads whatever they have, we shrink it.
//
// PDFs are compressed with Ghostscript when it's available on the host (150 dpi
// /ebook preset). If Ghostscript isn't installed, PDFs pass through untouched —
// it is an OPTIONAL host dependency, never required for an upload to succeed.
import { promises as fs } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extForMime } from "@/lib/documents";

const execFileP = promisify(execFile);

// A document scan is fully legible well under this — 2200px on the long edge
// keeps EID/passport text crisp while cutting size dramatically.
const MAX_EDGE = 2200;
const WEBP_QUALITY = 78;
const PDF_SETTING = "/ebook"; // Ghostscript: /screen(72dpi) /ebook(150) /printer(300)
const GS_TIMEOUT_MS = 30_000;

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif",
]);

export type OptimizedFile = { buffer: Buffer; mime: string; ext: string; fileName: string };

function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

// ── Ghostscript resolution (resolved once per server lifetime) ──
let gsResolved: string | null | undefined;
async function resolveGs(): Promise<string | null> {
  if (gsResolved !== undefined) return gsResolved;
  const works = async (bin: string): Promise<boolean> => {
    try { await execFileP(bin, ["--version"], { timeout: 5000 }); return true; } catch { return false; }
  };
  const envBin = process.env.GS_BIN;
  if (envBin && existsSync(envBin) && (await works(envBin))) return (gsResolved = envBin);
  for (const bin of ["gs", "gswin64c"]) {
    if (await works(bin)) return (gsResolved = bin);
  }
  for (const base of ["D:\\gs", "C:\\Program Files\\gs", "C:\\Program Files (x86)\\gs"]) {
    try {
      for (const d of readdirSync(base)) {
        const p = path.join(base, d, "bin", "gswin64c.exe");
        if (existsSync(p) && (await works(p))) return (gsResolved = p);
      }
    } catch { /* base absent */ }
  }
  return (gsResolved = null);
}

async function compressPdf(input: Buffer): Promise<Buffer | null> {
  const gs = await resolveGs();
  if (!gs) return null;
  const tmpRoot = path.join(process.env.UPLOAD_DIR || "./uploads", "_tmp");
  const inPath = path.join(tmpRoot, `${randomUUID()}.in.pdf`);
  const outPath = path.join(tmpRoot, `${randomUUID()}.out.pdf`);
  try {
    await fs.mkdir(tmpRoot, { recursive: true });
    await fs.writeFile(inPath, input);
    await execFileP(gs, [
      "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", `-dPDFSETTINGS=${PDF_SETTING}`,
      "-dDetectDuplicateImages=true", "-dCompressFonts=true",
      "-dNOPAUSE", "-dQUIET", "-dBATCH", `-sOutputFile=${outPath}`, inPath,
    ], { timeout: GS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const out = await fs.readFile(outPath);
    return out.length < input.length ? out : null; // keep only if smaller
  } catch {
    return null;
  } finally {
    fs.rm(inPath, { force: true }).catch(() => {});
    fs.rm(outPath, { force: true }).catch(() => {});
  }
}

/**
 * Optimise an uploaded document for storage.
 * - Images: auto-orient (EXIF), strip metadata, downscale to fit MAX_EDGE, and
 *   re-encode to WebP. Falls back to the original if that wouldn't be smaller.
 * - PDFs: compressed via Ghostscript when available; otherwise untouched.
 * - Anything else: returned untouched.
 * Never throws — any failure returns the original bytes so an upload never breaks.
 */
export async function optimizeDocument(input: Buffer, mime: string, fileName = "file"): Promise<OptimizedFile> {
  const m = (mime || "").toLowerCase();
  const looksImage = IMAGE_MIMES.has(m) || /\.(jpe?g|png|webp|gif|tiff?|heic|heif)$/i.test(fileName);
  const looksPdf = m === "application/pdf" || /\.pdf$/i.test(fileName);

  const passthrough = (): OptimizedFile => ({
    buffer: input,
    mime: mime || "application/octet-stream",
    ext: extForMime(mime, fileName),
    fileName,
  });

  if (looksPdf) {
    const smaller = await compressPdf(input);
    return smaller
      ? { buffer: smaller, mime: "application/pdf", ext: ".pdf", fileName }
      : passthrough();
  }

  if (!looksImage) return passthrough();

  try {
    // Dynamic import so a missing/broken native binary degrades to storing the
    // original rather than crashing the upload path.
    const sharp = (await import("sharp")).default;
    const out = await sharp(input, { failOn: "none" })
      .rotate() // apply EXIF orientation, then drop the metadata
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    if (out.length < input.length) {
      return { buffer: out, mime: "image/webp", ext: ".webp", fileName: `${baseName(fileName)}.webp` };
    }
    return passthrough();
  } catch {
    return passthrough();
  }
}

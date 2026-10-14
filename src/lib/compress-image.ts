"use client";

// Shrink a big phone photo in the browser before it is uploaded.
//
// A 12 MP camera shot is 6–12 MB; sending that over a hotel's wifi is what makes an
// upload sit and then fail. Drawing it to a canvas at a sane size first turns it into
// a few hundred KB, which uploads in a moment and is still far more detail than any
// document scan needs. The server shrinks it again (lib/optimize.ts) — this is purely
// to get the bytes off the device.
//
// Never throws: anything unexpected returns the original file, so an upload can only
// be helped by this, never blocked.

const MAX_EDGE = 2400; // plenty for reading an ID card or a certificate
const QUALITY = 0.82;
const SKIP_UNDER = 1.5 * 1024 * 1024; // small photos are already fine

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < SKIP_UNDER) return file;
  // HEIC/HEIF cannot be decoded by most browsers; let the server handle those.
  if (/heic|heif/i.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file; // no gain — send the original

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export const prettySize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Regenerate the browser/app icons from the BME brand mark.
//
//   npm run make:icons
//
// Source is public/bme-logo-round.png — the same Brilliant Minds mark shown on the
// sign-in page, in its colour variant (the sign-in page itself uses the all-white
// version, which is invisible against a light browser tab).
//
// Writes the Next.js App-Router icon file conventions:
//   src/app/favicon.ico   — multi-size .ico (16/32/48) for /favicon.ico
//   src/app/icon.png      — 512px, becomes <link rel="icon">
//   src/app/apple-icon.png— 180px, becomes <link rel="apple-touch-icon">

import path from "node:path";
import { promises as fsp } from "node:fs";
import sharp from "sharp";

const SRC = path.resolve("public/bme-logo-round.png");
const APP = path.resolve("src/app");

/** Pack PNG buffers into a single .ico container (ICO allows PNG payloads). */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const DIR_ENTRY = 16;
  let offset = header.length + images.length * DIR_ENTRY;
  const entries: Buffer[] = [];
  for (const { size, png } of images) {
    const e = Buffer.alloc(DIR_ENTRY);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const render = (size: number) =>
  sharp(SRC)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

async function main() {
  const [ico16, ico32, ico48, icon512, apple180] = await Promise.all(
    [16, 32, 48, 512, 180].map(render),
  );

  await fsp.writeFile(
    path.join(APP, "favicon.ico"),
    buildIco([
      { size: 16, png: ico16 },
      { size: 32, png: ico32 },
      { size: 48, png: ico48 },
    ]),
  );
  await fsp.writeFile(path.join(APP, "icon.png"), icon512);
  // Apple touch icons are composited on white, so flatten the transparency.
  await fsp.writeFile(
    path.join(APP, "apple-icon.png"),
    await sharp(apple180).flatten({ background: "#ffffff" }).png().toBuffer(),
  );

  console.log("wrote src/app/favicon.ico, src/app/icon.png, src/app/apple-icon.png");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

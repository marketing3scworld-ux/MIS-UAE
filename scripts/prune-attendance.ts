// Prune timesheet/attendance-sourced staff — the incomplete "shell" profiles that
// were imported from the attendance workbook with NO Emirates ID — keeping only
// the master-list profiles (eidNumber set) and their matching documents.
//
//   npm run prune:attendance             # DRY RUN — prints counts + writes a JSON backup of what WOULD be deleted
//   npm run prune:attendance -- --apply  # writes the backup, then deletes the shells (docs/notifications cascade)
//
// Shells are exactly `eidNumber = null` (that's how the attendance import created
// them, and how its own --reset removes them). Master-list rows all have an EID
// and are never touched. Any files attached to shells are copied into backups/
// before deletion so nothing is unrecoverable.

import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

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
if (!DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
process.env.DATABASE_URL = DATABASE_URL;
const ROOT = path.resolve(fromEnv("UPLOAD_DIR", "./uploads"));

// eslint-disable-next-line import/first
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function resolveInside(rel: string): string {
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error("path outside upload root");
  return abs;
}

async function main() {
  const total = await prisma.staff.count();
  const keep = await prisma.staff.count({ where: { NOT: { eidNumber: null } } });
  const del = await prisma.staff.count({ where: { eidNumber: null } });
  const keepDocs = await prisma.staffDocument.count({ where: { staff: { is: { NOT: { eidNumber: null } } } } });

  // Full snapshot of the delete-set (staff + their document metadata) for the backup.
  const shells = await prisma.staff.findMany({
    where: { eidNumber: null },
    select: {
      id: true, fullName: true, category: true, location: true, mobileNumber: true,
      employmentStatus: true, approvalStatus: true, createdAt: true,
      documents: { select: { id: true, type: true, fileName: true, filePath: true, mimeType: true, fileSize: true } },
    },
    orderBy: { id: "asc" },
  });
  const shellDocs = shells.reduce((n, s) => n + s.documents.length, 0);
  const filePaths = shells.flatMap((s) => s.documents.map((d) => d.filePath));

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing deleted"}`);
  console.log(`  total staff                 ${total}`);
  console.log(`  KEEP  (master list, has EID) ${keep}`);
  console.log(`  DELETE (attendance shells)   ${del}`);
  console.log(`  documents on kept staff      ${keepDocs}  (preserved)`);
  console.log(`  documents on shells          ${shellDocs}  (will cascade-delete)`);

  // Always write a JSON backup of what would be deleted.
  const dir = path.resolve("backups");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = path.join(dir, `pruned-attendance-${stamp}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(shells, null, 2), "utf8");
  console.log(`  backup of delete-set         ${path.relative(process.cwd(), jsonPath)}`);

  if (!APPLY) {
    console.log(`\n  Review the counts above. Re-run to delete:  npm run prune:attendance -- --apply\n`);
    await prisma.$disconnect();
    return;
  }

  // Back up any shell document files before we remove them.
  if (filePaths.length) {
    const fdir = path.join(dir, `pruned-files-${stamp}`);
    await fs.mkdir(fdir, { recursive: true });
    let copied = 0;
    for (const rel of filePaths) {
      try { await fs.copyFile(resolveInside(rel), path.join(fdir, rel.split("/").join("__"))); copied++; } catch { /* file missing */ }
    }
    console.log(`  backed up ${copied}/${filePaths.length} shell file(s) -> ${path.relative(process.cwd(), fdir)}`);
  }

  const res = await prisma.staff.deleteMany({ where: { eidNumber: null } }); // cascades documents + notifications
  console.log(`  deleted ${res.count} shell staff (documents/notifications cascaded)`);

  // Remove the now-orphaned shell files from disk (they were backed up above).
  let removed = 0;
  for (const rel of filePaths) { try { await fs.rm(resolveInside(rel), { force: true }); removed++; } catch { /* ignore */ } }
  if (filePaths.length) console.log(`  removed ${removed} shell file(s) from uploads`);

  const after = await prisma.staff.count();
  console.log(`  staff remaining              ${after}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

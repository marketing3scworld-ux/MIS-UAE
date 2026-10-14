// Diagnostic: are the unmatched document folders people WITHOUT a profile (expected)
// or a name-matching gap we could recover?
import path from "node:path";
import { promises as fs } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const staff = await prisma.staff.findMany({ select: { id: true, fullName: true } });
  const dbNames = new Set(staff.map((s) => norm(s.fullName)));

  const check = [
    "ALAOMA OHAERI", "EMMANUEL CHIBUZO OSUJI", "ABEDUNMI TEMITOPE", "GIFT AGABA",
    "EVELYN NKUAH ANDOH", "DORIS ACHEAMPONG", "ALEXANDER NII MENSAH", "VIDA KYEI",
    "RALPH AGYEMANG", "THERESA AGYEIWA",
  ];
  console.log("Are the top unmatched names actually in the DB (profiled)?");
  for (const n of check) console.log(`  ${dbNames.has(norm(n)) ? "IN DB (BUG!)" : "not a profile"}  ${n}`);

  const withDocs = new Set(
    (await prisma.staffDocument.findMany({ where: { isCurrent: true }, select: { staffId: true }, distinct: ["staffId"] }))
      .map((d) => d.staffId),
  );
  const noDocs = staff.filter((s) => !withDocs.has(s.id));

  // Collect all folder names in data/ (top level + one nesting level under grouping folders).
  const folderNames = new Set<string>();
  const top = await fs.readdir(path.resolve("data"), { withFileTypes: true });
  for (const e of top) {
    if (!e.isDirectory()) continue;
    folderNames.add(norm(e.name));
    try {
      const sub = await fs.readdir(path.join(path.resolve("data"), e.name), { withFileTypes: true });
      for (const s of sub) if (s.isDirectory()) folderNames.add(norm(s.name));
    } catch {}
  }

  const noDocsButFolderExists = noDocs.filter((s) => folderNames.has(norm(s.fullName)));
  console.log(`\nStaff with 0 docs: ${noDocs.length}`);
  console.log(`  ...of those, a data/ folder with the EXACT name exists (recoverable): ${noDocsButFolderExists.length}`);
  noDocsButFolderExists.slice(0, 15).forEach((s) => console.log(`     RECOVERABLE: ${s.fullName}`));
  console.log(`  ...sample with no matching folder at all:`);
  noDocs.filter((s) => !folderNames.has(norm(s.fullName))).slice(0, 10).forEach((s) => console.log(`     no folder: ${s.fullName}`));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

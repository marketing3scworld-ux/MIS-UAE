// Quick post-import sanity check (via Prisma — avoids psql shell-quoting pain).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.staff.count();
  const active = await prisma.staff.count({ where: { employmentStatus: "ACTIVE" } });
  const withEidExp = await prisma.staff.count({ where: { eidExpiry: { not: null } } });
  const withOhc = await prisma.staff.count({ where: { ohcExpiry: { not: null } } });
  const withPassExp = await prisma.staff.count({ where: { passportExpiry: { not: null } } });
  const withIban = await prisma.staff.count({ where: { iban: { not: null } } });
  const sample = await prisma.staff.findMany({
    orderBy: { id: "asc" },
    take: 3,
    select: {
      id: true, fullName: true, eidNumber: true, eidExpiry: true,
      ohcExpiry: true, passportExpiry: true, gender: true, category: true,
      location: true, nationality: true,
    },
  });
  console.log("counts:", { total, active, withEidExp, withOhc, withPassExp, withIban });
  console.log("sample:", JSON.stringify(sample, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

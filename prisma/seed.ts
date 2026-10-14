// Seed: one System Admin user, the Settings-managed dropdown lists, and app
// config defaults (§11). Idempotent — safe to re-run (upserts). The 5 RBAC
// "roles" are the Role enum (no table to seed).
//
//   npx prisma db seed   (or: npm run seed)

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CLIENTS } from "./seed-clients";

const prisma = new PrismaClient();

// Base dropdown values (single values; combined ones like COMMIS/FOH come from
// the real data at import time). From spec §3.
const CATEGORIES = [
  "BARBACK", "BARTENDER", "BRAND AMBASSADOR", "BUSSER", "CAPTAIN", "CASHIER",
  "CHEF", "CLEANER", "COMMIS", "COMMIS/BARTENDER", "COMMIS/FOH", "COOK",
  "DISHWASHER", "EVENT COORDINATOR", "FOH", "HOST", "HOSTESS", "HOUSEKEEPING",
  "KITCHEN STEWARD", "MIXOLOGIST", "PORTER", "PROMOTER", "RECEPTIONIST",
  "RUNNER", "SECURITY", "SOMMELIER", "STEWARD", "SUPERVISOR", "USHER",
  "VALET", "WAITER", "WAITRESS",  
];
// SERVICE locations — the work sites.
const LOCATIONS = [
  "ATR", "ATP", "JCH", "JRCC", "EMAAR", "AL DAITH",
  "MANDARIN ORIENTAL DOWNTOWN", "MANDARIN ORIENTAL JUMEIRAH", "SKYVIEW",
  "MADINAT", "DUBAI OPERA", "LE MERIDIAN", "IRISH VILLAGE", "DUBAI SOUTH",
  "EMIRATES TOWER", "MEDIA ONE", "RAK", "WESTFIELD",
  "DUBAI HILLS"
];
// RESIDENCE locations — where staff live. Kept to the seven emirates plus Al Ain,
// deliberately separate from the venue list above.
const RESIDENCES = [
  "ABU DHABI", "DUBAI", "SHARJAH", "AJMAN", "UMM AL QUWAIN",
  "RAS AL KHAIMAH", "FUJAIRAH", "AL AIN",
];
const NATIONALITIES = [
  "PHILIPPINES", "INDIA", "BANGLADESH", "TANZANIA", "SENEGAL", "NIGERIA",
  "NEPAL", "KENYA", "CAMEROON", "GHANA", "SRI LANKA", "PAKISTAN",
];
const BANKS = ["EMIRATES NBD", "MASHREQ BANK", "ADCB BANK PJSC", "DUBAI ISLAMIC BANK"];
// Phase 2 shift presets — prefill the start/end times on the scheduling form.
const SHIFTS: [string, string | null, string | null][] = [
  ["MORNING", "06:00", "14:00"],
  ["AFTERNOON", "14:00", "22:00"],
  ["NIGHT", "22:00", "06:00"],
  ["DAY", "09:00", "18:00"],
  ["SPLIT", null, null],
];

// Configurable engine/notification defaults (§6/§7).
const SETTINGS: Record<string, string> = {
  expiryWindowDays: "30",
  reNotifyIntervalDays: "3",
  escalationThresholdCycles: "3",
};

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@bmeventsksa.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin@BME2026";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "System Administrator",
      role: Role.SYSTEM_ADMIN,
      passwordHash,
      isActive: true,
    },
  });

  for (let i = 0; i < CATEGORIES.length; i++) {
    await prisma.categoryOption.upsert({
      where: { value: CATEGORIES[i] },
      update: {},
      create: { value: CATEGORIES[i], sortOrder: i },
    });
  }
  for (let i = 0; i < LOCATIONS.length; i++) {
    await prisma.locationOption.upsert({
      where: { value: LOCATIONS[i] },
      update: {},
      create: { value: LOCATIONS[i], sortOrder: i },
    });
  }
  for (let i = 0; i < RESIDENCES.length; i++) {
    await prisma.residenceOption.upsert({
      where: { value: RESIDENCES[i] },
      update: {},
      create: { value: RESIDENCES[i], sortOrder: i },
    });
  }
  for (const value of NATIONALITIES) {
    await prisma.nationalityOption.upsert({ where: { value }, update: {}, create: { value } });
  }
  for (const value of BANKS) {
    await prisma.bankOption.upsert({ where: { value }, update: {}, create: { value } });
  }
  for (let i = 0; i < SHIFTS.length; i++) {
    const [value, startTime, endTime] = SHIFTS[i];
    await prisma.shiftOption.upsert({
      where: { value },
      update: {},
      create: { value, startTime, endTime, sortOrder: i },
    });
  }
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  // The customer list. `update: {}` deliberately leaves an existing client alone:
  // re-seeding must never re-enable a client someone switched off on purpose, nor
  // undo a name corrected in the UI.
  for (const name of CLIENTS) {
    await prisma.client.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log(
    `Seeded: admin=${adminEmail} (password: ${adminPassword} — CHANGE ON FIRST LOGIN), ` +
      `${CATEGORIES.length} categories, ${LOCATIONS.length} locations, ` +
      `${NATIONALITIES.length} nationalities, ${BANKS.length} banks, ` +
      `${Object.keys(SETTINGS).length} settings, ${CLIENTS.length} clients.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

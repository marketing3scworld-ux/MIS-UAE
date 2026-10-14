// Prisma client singleton.
//
// Next.js hot-reloads modules in dev, which would otherwise spawn a new
// PrismaClient (and a new DB connection pool) on every reload until Postgres
// runs out of connections. Caching the instance on globalThis avoids that.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

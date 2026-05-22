import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Prisma client singleton.
// In development, Next.js hot-reload creates multiple module instances.
// We stash the client on globalThis to avoid exhausting connection pools.
// In production, the module is only loaded once, so globalThis is never used.
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

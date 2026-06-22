import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getRedisClient } from "@/lib/realtime/redis";
import { logger } from "@/lib/logger";

// Force Node.js runtime — required for Prisma and ioredis.
export const runtime = "nodejs";

// This endpoint is public (used by the platform healthcheck). It must not leak
// infrastructure detail. Boolean component status is fine; raw connection-error
// strings (hostnames, ports, driver versions) are logged server-side only.
// Admins get detailed diagnostics via the authenticated /admin/status page.
type HealthResult = {
  ok: boolean;
  checks: { postgres: boolean; redis: boolean };
  at: string;
};

/** Resolves to `value` after `ms` ms — used to race against slow connections. */
function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function GET(): Promise<NextResponse<HealthResult>> {
  const checks = { postgres: false, redis: false };

  // Postgres — 5 s hard timeout so a slow first connection doesn't stall the healthcheck.
  try {
    const result = await Promise.race([
      db.$queryRaw`SELECT 1`.then(() => true),
      timeout(5000, false),
    ]);
    if (result) {
      checks.postgres = true;
    } else {
      logger.error("health: postgres timed out after 5 s");
    }
  } catch (err) {
    logger.error({ err }, "health: postgres check failed");
  }

  // Redis — 5 s hard timeout.
  try {
    const pong = await Promise.race([
      getRedisClient().ping(),
      timeout(5000, "TIMEOUT"),
    ]);
    if (pong === "PONG") {
      checks.redis = true;
    } else {
      logger.error({ pong }, "health: redis check failed");
    }
  } catch (err) {
    logger.error({ err }, "health: redis check failed");
  }

  const ok = checks.postgres && checks.redis;

  // Always 200 — the platform healthcheck passes as long as the app is running.
  // Detailed failure reasons are logged server-side and shown on /admin/status.
  return NextResponse.json({ ok, checks, at: new Date().toISOString() }, { status: 200 });
}

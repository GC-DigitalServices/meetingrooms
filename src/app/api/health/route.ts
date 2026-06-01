import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getRedisClient } from "@/lib/realtime/redis";

// Force Node.js runtime — required for Prisma and ioredis.
export const runtime = "nodejs";

type HealthResult = {
  ok: boolean;
  checks: { postgres: boolean; redis: boolean };
  errors: string[];
  at: string;
};

/** Resolves to `value` after `ms` ms — used to race against slow connections. */
function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function GET(): Promise<NextResponse<HealthResult>> {
  const checks = { postgres: false, redis: false };
  const errors: string[] = [];

  // Postgres — 5 s hard timeout so a slow first connection doesn't stall the healthcheck.
  try {
    const result = await Promise.race([
      db.$queryRaw`SELECT 1`.then(() => true),
      timeout(5000, false),
    ]);
    if (result) {
      checks.postgres = true;
    } else {
      errors.push("postgres: timed out after 5 s");
    }
  } catch (err) {
    errors.push(`postgres: ${err instanceof Error ? err.message : String(err)}`);
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
      errors.push(`redis: ${pong === "TIMEOUT" ? "timed out after 5 s" : `unexpected response: ${pong}`}`);
    }
  } catch (err) {
    errors.push(`redis: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ok = checks.postgres && checks.redis;

  // Always 200 — Railway healthcheck passes as long as the app is running.
  // DB/Redis failures surface in the body and in the admin status indicator.
  return NextResponse.json({ ok, checks, errors, at: new Date().toISOString() }, { status: 200 });
}

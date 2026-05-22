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

export async function GET(): Promise<NextResponse<HealthResult>> {
  const checks = { postgres: false, redis: false };
  const errors: string[] = [];

  // Postgres
  try {
    await db.$queryRaw`SELECT 1`;
    checks.postgres = true;
  } catch (err) {
    errors.push(`postgres: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Redis
  try {
    const pong = await getRedisClient().ping();
    if (pong === "PONG") {
      checks.redis = true;
    } else {
      errors.push(`redis: unexpected ping response: ${pong}`);
    }
  } catch (err) {
    errors.push(`redis: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ok = checks.postgres && checks.redis;
  const status = ok ? 200 : 503;

  return NextResponse.json({ ok, checks, errors, at: new Date().toISOString() }, { status });
}

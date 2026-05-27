import Redis from "ioredis";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Redis client singleton.
// Used for: booking locks (phase 3), MSAL token cache (phase 3),
//           Socket.IO session state (phase 4).
// ---------------------------------------------------------------------------

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function getRedisClient(): Redis {
  if (globalForRedis.redis) return globalForRedis.redis;

  const client = new Redis(getConfig().REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("error", (err) => {
    // Logged here so callers don't need to attach their own error handlers.
    // ioredis reconnects automatically; this prevents uncaught promise rejections.
    logger.error({ err }, "redis: connection error");
  });

  if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = client;
  }

  return client;
}

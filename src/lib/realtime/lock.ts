import { getRedisClient } from "./redis";
import { logger } from "@/lib/logger";
import { LockTimeoutError } from "@/lib/booking/errors";

const LOCK_TTL_MS = 5_000;
const DEFAULT_RETRIES = 8;
const BASE_RETRY_DELAY_MS = 100;

// Lua script: delete the key only if we own it (token matches).
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

async function acquire(key: string): Promise<string | null> {
  const token = globalThis.crypto.randomUUID();
  const result = await getRedisClient().set(key, token, "PX", LOCK_TTL_MS, "NX");
  return result === "OK" ? token : null;
}

async function release(key: string, token: string): Promise<void> {
  await getRedisClient().eval(RELEASE_SCRIPT, 1, key, token);
}

/**
 * Acquire the lock for `key`, run `fn`, then release.
 * Retries with exponential back-off + jitter up to `retries` times.
 * Throws LockTimeoutError if the lock cannot be acquired.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES
): Promise<T> {
  let token: string | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const jitter = Math.random() * BASE_RETRY_DELAY_MS;
      await new Promise<void>((r) =>
        setTimeout(r, BASE_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1) + jitter)
      );
    }
    token = await acquire(key);
    if (token) break;
  }

  if (!token) {
    logger.warn({ key, retries }, "lock: failed to acquire after retries");
    throw new LockTimeoutError(key);
  }

  try {
    return await fn();
  } finally {
    await release(key, token).catch((err) =>
      logger.error({ key, err }, "lock: release failed")
    );
  }
}

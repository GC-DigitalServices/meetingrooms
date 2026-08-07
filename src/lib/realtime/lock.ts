import { getRedisClient } from "./redis";
import { logger } from "@/lib/logger";
import { LockTimeoutError } from "@/lib/booking/errors";

const LOCK_TTL_MS = 15_000;        // lease length; a crashed holder frees within this
const RENEW_INTERVAL_MS = 5_000;   // extend the lease this often while fn() runs
const ACQUIRE_TIMEOUT_MS = 10_000; // how long a waiter keeps retrying before giving up
const BASE_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 1_000;

// Lua: delete the key only if we still own it (token matches).
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

// Lua: extend the TTL only if we still own it — never resurrect a lock we've
// already lost (expired) or released.
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquire(key: string): Promise<string | null> {
  const token = globalThis.crypto.randomUUID();
  const result = await getRedisClient().set(key, token, "PX", LOCK_TTL_MS, "NX");
  return result === "OK" ? token : null;
}

async function release(key: string, token: string): Promise<void> {
  await getRedisClient().eval(RELEASE_SCRIPT, 1, key, token);
}

async function renew(key: string, token: string): Promise<void> {
  await getRedisClient().eval(RENEW_SCRIPT, 1, key, token, String(LOCK_TTL_MS));
}

/**
 * Acquire the lock for `key`, run `fn`, then release.
 *
 * While `fn` runs, a watchdog extends the lease every RENEW_INTERVAL_MS so the
 * lock cannot expire mid-critical-section — even when the Graph write inside is
 * slow (composite bookings across several mailboxes, or the Graph client's
 * 2/4/8s throttling back-off). The renewals are driven by `setInterval` and
 * still fire during the `await`ed, non-blocking Graph call. This closes the
 * double-booking window that existed when the fixed 5s TTL could lapse before
 * the write finished. If the holder process dies, the lease still lapses after
 * LOCK_TTL_MS.
 *
 * Waiters retry with capped exponential back-off + jitter until
 * ACQUIRE_TIMEOUT_MS, then throw LockTimeoutError.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  let token: string | null = null;

  for (let attempt = 0; ; attempt++) {
    token = await acquire(key);
    if (token) break;
    if (Date.now() >= deadline) break;
    const backoff = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt);
    await sleep(backoff + Math.random() * BASE_RETRY_DELAY_MS);
  }

  if (!token) {
    logger.warn({ key }, "lock: failed to acquire before timeout");
    throw new LockTimeoutError(key);
  }

  const heartbeat = setInterval(() => {
    renew(key, token!).catch((err) => logger.error({ key, err }, "lock: renew failed"));
  }, RENEW_INTERVAL_MS);
  // Don't let the watchdog timer keep the process alive on its own.
  (heartbeat as { unref?: () => void }).unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await release(key, token).catch((err) =>
      logger.error({ key, err }, "lock: release failed")
    );
  }
}

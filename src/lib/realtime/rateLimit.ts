import { getRedisClient } from "./redis";
import { logger } from "@/lib/logger";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSecs: number;
}

// Atomic sliding-window rate limiter.
// Stores each admitted request as a scored set member (score = timestamp ms).
// ZREMRANGEBYSCORE purges entries outside the window; ZCARD counts what's left.
// The check-and-insert happens in one Lua call so there is no TOCTOU gap.
const SCRIPT = `
local key = KEYS[1]
local now  = tonumber(ARGV[1])
local win  = tonumber(ARGV[2])
local lim  = tonumber(ARGV[3])
local uid  = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
local n = redis.call('ZCARD', key)
if n < lim then
  redis.call('ZADD', key, now, uid)
  redis.call('PEXPIRE', key, win)
  return {1, lim - n - 1}
end
return {0, 0}
`;

/**
 * Check and record one request against a sliding-window rate limit.
 *
 * @param key      Redis key, e.g. "rl:write:user:jsmith@college.ac.uk"
 * @param limit    Maximum requests allowed in the window
 * @param windowMs Window length in milliseconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const now = Date.now();
  const uid = `${now}:${Math.random().toString(36).slice(2, 9)}`;

  try {
    const res = (await redis.eval(
      SCRIPT,
      1,
      key,
      now,
      windowMs,
      limit,
      uid,
    )) as [number, number];

    const allowed = res[0] === 1;
    return {
      allowed,
      remaining: res[1],
      retryAfterSecs: allowed ? 0 : Math.ceil(windowMs / 1000),
    };
  } catch (err) {
    // Fail open — better to let a request through than to block legitimate
    // users because Redis is temporarily unreachable.
    logger.warn({ err, key }, "rateLimit: Redis unavailable, failing open");
    return { allowed: true, remaining: -1, retryAfterSecs: 0 };
  }
}

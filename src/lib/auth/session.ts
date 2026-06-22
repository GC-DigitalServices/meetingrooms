import { getRedisClient } from "@/lib/realtime/redis";
import { logger } from "@/lib/logger";

const SESSION_TTL_SLIDING_S = 8 * 60 * 60;          // 8 h sliding
const SESSION_TTL_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days absolute
const SESSION_TTL_ABSOLUTE_S = SESSION_TTL_ABSOLUTE_MS / 1000;

export interface Session {
  upn: string;
  displayName: string;
  groupIds: string[];
  isStaff: boolean;
  isAdmin: boolean;
  termsAccepted: boolean;
  signedInAt: number; // unix ms — used for 30-day absolute limit
  lastActiveAt: number;
}

function key(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Per-user index of live session IDs — enables forced logout / offboarding. */
function userIndexKey(upn: string): string {
  return `user:sessions:${upn.toLowerCase()}`;
}

export async function createSession(data: Omit<Session, "lastActiveAt">): Promise<string> {
  const sessionId = globalThis.crypto.randomUUID();
  const session: Session = { ...data, lastActiveAt: Date.now() };
  const redis = getRedisClient();
  await redis.set(
    key(sessionId),
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SLIDING_S
  );
  // Track the session under the user so we can revoke every session at once.
  // The index outlives the sliding window (bounded by the absolute limit); it
  // self-heals because revoke/load discard ids whose session key has expired.
  await redis.sadd(userIndexKey(data.upn), sessionId);
  await redis.expire(userIndexKey(data.upn), SESSION_TTL_ABSOLUTE_S);
  return sessionId;
}

/** Loads and refreshes a session. Returns null if expired or not found. */
export async function loadSession(sessionId: string): Promise<Session | null> {
  const raw = await getRedisClient().get(key(sessionId));
  if (!raw) return null;

  const session = JSON.parse(raw) as Session;

  // Absolute 30-day limit
  if (Date.now() - session.signedInAt > SESSION_TTL_ABSOLUTE_MS) {
    await getRedisClient().del(key(sessionId));
    await getRedisClient().srem(userIndexKey(session.upn), sessionId);
    return null;
  }

  // Refresh sliding TTL
  session.lastActiveAt = Date.now();
  await getRedisClient().set(
    key(sessionId),
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SLIDING_S
  );

  return session;
}

/** Patches specific fields on an existing session without touching the TTL logic. */
export async function patchSession(
  sessionId: string,
  patch: Partial<Pick<Session, "termsAccepted">>
): Promise<void> {
  const raw = await getRedisClient().get(key(sessionId));
  if (!raw) return;
  const session = JSON.parse(raw) as Session;
  Object.assign(session, patch);
  await getRedisClient().set(key(sessionId), JSON.stringify(session), "KEEPTTL");
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  // Read the upn first so we can also drop it from the per-user index.
  const raw = await redis.get(key(sessionId));
  await redis.del(key(sessionId));
  if (raw) {
    try {
      const { upn } = JSON.parse(raw) as Session;
      await redis.srem(userIndexKey(upn), sessionId);
    } catch {
      // Malformed payload — the session key is already gone, nothing else to do.
    }
  }
}

/**
 * Revokes every active session for a user — an immediate force-logout.
 * Use on offboarding or role downgrade. Returns the number of sessions killed.
 */
export async function revokeUserSessions(upn: string): Promise<number> {
  const redis = getRedisClient();
  const indexKey = userIndexKey(upn);
  const sessionIds = await redis.smembers(indexKey);
  if (sessionIds.length > 0) {
    await redis.del(...sessionIds.map(key));
  }
  await redis.del(indexKey);
  logger.info({ upn, count: sessionIds.length }, "session: revoked all sessions for user");
  return sessionIds.length;
}

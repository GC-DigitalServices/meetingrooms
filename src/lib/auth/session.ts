import { getRedisClient } from "@/lib/realtime/redis";

const SESSION_TTL_SLIDING_S = 8 * 60 * 60;          // 8 h sliding
const SESSION_TTL_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days absolute

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

export async function createSession(data: Omit<Session, "lastActiveAt">): Promise<string> {
  const sessionId = globalThis.crypto.randomUUID();
  const session: Session = { ...data, lastActiveAt: Date.now() };
  await getRedisClient().set(
    key(sessionId),
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SLIDING_S
  );
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
  await getRedisClient().del(key(sessionId));
}

import type { NextRequest } from "next/server";
import { loadSession, revokeUserSessions } from "./session";
import type { Session } from "./session";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";

export type { Session } from "./session";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Reads the session cookie, loads from Redis, refreshes TTL.
 * Throws AuthError (→ 401) if missing or expired.
 */
export async function requireSession(req: NextRequest): Promise<Session> {
  const sessionId = req.cookies.get("session")?.value;
  if (!sessionId) throw new AuthError("No session cookie");

  const session = await loadSession(sessionId);
  if (!session) throw new AuthError("Session expired or invalid");

  return session;
}

/**
 * Like requireSession, but re-confirms admin status against the database rather
 * than trusting the (possibly stale) cached flag in the session. If the user's
 * admin rights have been revoked since sign-in, every session for that user is
 * killed immediately and the request is rejected. Throws AuthError (401) when
 * unauthenticated, ForbiddenError (403) when not (or no longer) an admin.
 */
export async function requireAdmin(req: NextRequest): Promise<Session> {
  const session = await requireSession(req);

  const user = await db.user.findUnique({
    where: { upn: session.upn },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    if (session.isAdmin) {
      // Cached session still claims admin but the DB disagrees → revoke now.
      logger.warn({ upn: session.upn }, "auth: stale admin session — revoking");
      await revokeUserSessions(session.upn).catch(() => {});
    }
    throw new ForbiddenError("Admin required");
  }

  return session;
}

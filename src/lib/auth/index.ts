import type { NextRequest } from "next/server";
import { loadSession } from "./session";
import type { Session } from "./session";

export type { Session } from "./session";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
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

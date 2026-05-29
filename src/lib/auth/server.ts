import { cookies } from "next/headers";
import { loadSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/session";

/**
 * Reads the session cookie from Next.js server context.
 * Use in Server Components and Route Handlers that don't receive NextRequest.
 */
export async function getServerSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (!sessionId) return null;
  return loadSession(sessionId);
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadSession, patchSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

/**
 * POST /api/auth/accept-terms
 * Sets User.termsAcceptedAt and marks the current session as accepted.
 * No request body needed — the session cookie identifies the user.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const { PUBLIC_BASE_URL } = getConfig();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/sign-in`);
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/sign-in`);
  }

  // Persist in DB so future sign-ins inherit the acceptance
  await db.user.update({
    where: { upn: session.upn },
    data: { termsAcceptedAt: new Date() },
  });

  // Update the live Redis session so the portal layout picks it up immediately
  await patchSession(sessionId, { termsAccepted: true });

  const { searchParams } = new URL(req.url);
  const next = searchParams.get("next");
  const destination = next && next.startsWith("/") ? next : "/";

  return NextResponse.redirect(`${PUBLIC_BASE_URL}${destination}`);
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { cancelRemainingRecurring } from "@/lib/booking/service";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { apiError, bookingServiceError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:write:user:${session.upn}`, 5, 60_000);
  if (!rl.allowed) return apiError("RATE_LIMITED", "Too many requests. Please wait a moment.");

  const { groupId } = await params;

  try {
    const cancelled = await cancelRemainingRecurring(groupId, session);
    return NextResponse.json({ cancelled });
  } catch (err) {
    return bookingServiceError(err);
  }
}

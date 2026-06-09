import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { updateBooking, cancelBooking } from "@/lib/booking/service";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { writeAudit } from "@/lib/db/audit";
import { apiError, bookingServiceError } from "@/lib/api/errors";
import { z } from "zod";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  subject:       z.string().min(1).max(255).optional(),
  start:         z.string().datetime().optional(),
  end:           z.string().datetime().optional(),
  premisesNotes: z.string().max(1000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:write:user:${session.upn}`, 5, 60_000);
  if (!rl.allowed) {
    writeAudit({
      actor: session.upn,
      action: "booking.write.rate_limited",
      metadata: { method: "PATCH", endpoint: "/api/bookings/[id]" },
    }).catch(() => {});
    return apiError("RATE_LIMITED", "Too many booking requests. Please wait a moment and try again.", {
      headers: { "Retry-After": String(rl.retryAfterSecs) },
    });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid request body");
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });
  }

  const { subject, start, end, premisesNotes } = parsed.data;

  try {
    const booking = await updateBooking(id, {
      subject,
      start: start ? new Date(start) : undefined,
      end:   end   ? new Date(end)   : undefined,
      premisesNotes,
      actor: session,
    });
    return NextResponse.json(booking);
  } catch (err) {
    return bookingServiceError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:write:user:${session.upn}`, 5, 60_000);
  if (!rl.allowed) {
    writeAudit({
      actor: session.upn,
      action: "booking.write.rate_limited",
      metadata: { method: "DELETE", endpoint: "/api/bookings/[id]" },
    }).catch(() => {});
    return apiError("RATE_LIMITED", "Too many booking requests. Please wait a moment and try again.", {
      headers: { "Retry-After": String(rl.retryAfterSecs) },
    });
  }

  const { id } = await params;

  try {
    await cancelBooking(id, session);
    return new Response(null, { status: 204 });
  } catch (err) {
    return bookingServiceError(err);
  }
}

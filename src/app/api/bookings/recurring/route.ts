import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { createRecurringBookings } from "@/lib/booking/service";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { writeAudit } from "@/lib/db/audit";
import { apiError, bookingServiceError } from "@/lib/api/errors";
import { z } from "zod";

export const runtime = "nodejs";

const Schema = z.object({
  roomId:        z.string().min(1),
  subject:       z.string().min(1).max(255),
  start:         z.string().datetime(),
  end:           z.string().datetime(),
  repeatWeeks:   z.number().int().min(2).max(10),
  premisesNotes: z.string().max(1000).nullable().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:recurring:user:${session.upn}`, 3, 300_000);
  if (!rl.allowed) {
    writeAudit({
      actor: session.upn,
      action: "booking.write.rate_limited",
      metadata: { method: "POST", endpoint: "/api/bookings/recurring" },
    }).catch(() => {});
    return apiError("RATE_LIMITED", "Too many recurring booking requests. Please wait a moment.", {
      headers: { "Retry-After": String(rl.retryAfterSecs) },
    });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return apiError("VALIDATION_ERROR", "Invalid request body"); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });

  const { roomId, subject, start, end, repeatWeeks, premisesNotes } = parsed.data;

  try {
    const result = await createRecurringBookings({
      roomId,
      organiserUpn:  session.upn,
      organiserName: session.displayName,
      subject,
      start: new Date(start),
      end:   new Date(end),
      repeatWeeks,
      premisesNotes,
      actor: session,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return bookingServiceError(err);
  }
}

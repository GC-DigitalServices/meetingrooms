import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createBooking } from "@/lib/booking/service";
import { AuthError } from "@/lib/auth";
import { ERROR_STATUS } from "@/lib/booking/errors";
import { z } from "zod";

export const runtime = "nodejs";

const CreateSchema = z.object({
  roomId:        z.string().min(1),
  subject:       z.string().min(1).max(255),
  start:         z.string().datetime(),
  end:           z.string().datetime(),
  premisesNotes: z.string().max(1000).nullable().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { roomId, subject, start, end, premisesNotes } = parsed.data;

  try {
    const booking = await createBooking({
      roomId,
      organiserUpn:  session.upn,
      organiserName: session.displayName,
      subject,
      start: new Date(start),
      end:   new Date(end),
      premisesNotes,
      actor: session,
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    const status = err instanceof Error ? (ERROR_STATUS[err.constructor.name] ?? 500) : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status });
  }
}

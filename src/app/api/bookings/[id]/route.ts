import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { updateBooking, cancelBooking } from "@/lib/booking/service";
import { ERROR_STATUS } from "@/lib/booking/errors";
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
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
    const status = err instanceof Error ? (ERROR_STATUS[err.constructor.name] ?? 500) : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status });
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
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const { id } = await params;

  try {
    await cancelBooking(id, session);
    return new Response(null, { status: 204 });
  } catch (err) {
    const status = err instanceof Error ? (ERROR_STATUS[err.constructor.name] ?? 500) : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status });
  }
}

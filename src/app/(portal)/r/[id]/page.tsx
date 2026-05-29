import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { notFound } from "next/navigation";

export const runtime = "nodejs";

/**
 * QR-code landing route. Phase 5: redirects to room detail.
 * Phase 6 will add QR token validation (source=IPAD_QR tagging).
 */
export default async function QRLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const room = await db.room.findUnique({ where: { id }, select: { id: true } });
  if (!room) notFound();

  redirect(`/rooms/${id}`);
}

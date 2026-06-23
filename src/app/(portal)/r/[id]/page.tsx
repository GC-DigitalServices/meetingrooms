import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getServerSession } from "@/lib/auth/server";
import { verifyQrToken } from "@/lib/auth/device";
import { canSeeRoom } from "@/lib/booking/visibility";
import { canUserBookRoom } from "@/lib/booking/permissions";
import { logger } from "@/lib/logger";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";

/**
 * QR-code landing route.
 *
 * STANDARD/SECTION → redirects straight to /rooms/[id] (booking dialog is there).
 * COMPOSITE        → shows a section-chooser page inline so the user can pick
 *                    which section (or the whole room) to book.
 *
 * The `t` query parameter carries a short-lived HMAC QR token. If valid, the
 * booking source will be tagged IPAD_QR. If absent/expired the page still works
 * — the scan-source tag is just analytics.
 */
export default async function QrLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; from?: string }>;
}) {
  const { id } = await params;
  const { t, from } = await searchParams;

  const session = await getServerSession();
  if (!session) {
    const next = `/r/${id}${t ? `?t=${encodeURIComponent(t)}&from=${from ?? "display"}` : ""}`;
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  const room = await db.room.findUnique({
    where: { id },
    include: { sections: { orderBy: { displayName: "asc" } } },
  });
  if (!room) notFound();
  if (!canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, room, true)) notFound();

  // Validate QR token for source tagging (best-effort — page works either way)
  let isFromQr = false;
  if (t) {
    const payload = verifyQrToken(t);
    if (payload) {
      isFromQr = true;
    } else {
      logger.warn({ roomId: id }, "qr: invalid or expired token on landing");
    }
  }

  // Source hint passed along so the booking API can tag IPAD_QR
  const sourceParam = isFromQr ? "&source=IPAD_QR" : "";

  // STANDARD / SECTION — send straight to the room detail page
  if (room.kind !== "COMPOSITE") {
    redirect(`/rooms/${id}?from=display${sourceParam}`);
  }

  // COMPOSITE — show section chooser
  // Fetch current bookings for all sections to determine availability
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // next 24h

  const sectionIds = room.sections.map((s) => s.id);
  const activeBookings = await db.booking.findMany({
    where: {
      roomId: { in: [...sectionIds, room.id] },
      startUtc: { lt: soon },
      endUtc: { gt: now },
    },
  });

  const busyNow = new Set(
    activeBookings
      .filter((b) => b.startUtc <= now && b.endUtc > now)
      .map((b) => b.roomId),
  );

  const wholeRoomBusy = sectionIds.some((id) => busyNow.has(id)) || busyNow.has(room.id);

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{room.displayName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isFromQr
            ? "Scanned from display — choose what to book"
            : "Choose what to book"}
        </p>
      </div>

      <div className="space-y-3">
        {/* Individual sections */}
        {room.sections.map((section) => {
          const isBusy = busyNow.has(section.id);
          let canBook = false;
          try {
            canUserBookRoom(
              { isAdmin: session.isAdmin, groupIds: session.groupIds },
              section,
            );
            canBook = true;
          } catch {
            canBook = false;
          }

          return (
            <div
              key={section.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <div className="font-medium">{section.displayName}</div>
                <div className="flex items-center gap-2 mt-1">
                  {isBusy ? (
                    <Badge
                      variant="outline"
                      className="text-xs border-red-300 text-red-600"
                    >
                      Busy now
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs border-green-300 text-green-600"
                    >
                      Free now
                    </Badge>
                  )}
                  {section.capacity > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {section.capacity} {section.capacity === 1 ? "person" : "people"}
                    </span>
                  )}
                  {!canBook && (
                    <span className="text-xs text-muted-foreground">
                      Not available to you
                    </span>
                  )}
                </div>
              </div>
              <Button asChild disabled={isBusy || !canBook} size="sm">
                <Link
                  href={`/rooms/${section.id}?from=display${sourceParam}`}
                  aria-disabled={isBusy || !canBook}
                  tabIndex={isBusy || !canBook ? -1 : undefined}
                >
                  Book
                </Link>
              </Button>
            </div>
          );
        })}

        {/* Whole room */}
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
          <div>
            <div className="font-medium">Whole room</div>
            <div className="flex items-center gap-2 mt-1">
              {wholeRoomBusy ? (
                <Badge variant="outline" className="text-xs border-red-300 text-red-600">
                  Not fully free
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs border-green-300 text-green-600">
                  All sections free
                </Badge>
              )}
            </div>
          </div>
          <Button asChild disabled={wholeRoomBusy} size="sm" variant="secondary">
            <Link
              href={`/rooms/${room.id}?from=display${sourceParam}`}
              aria-disabled={wholeRoomBusy}
              tabIndex={wholeRoomBusy ? -1 : undefined}
            >
              Book whole room
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Find another room
        </Link>
      </div>
    </main>
  );
}

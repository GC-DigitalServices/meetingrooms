import Link from "next/link";
import { getServerSession } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { canSeeRoom } from "@/lib/booking/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import FavouriteRooms from "@/components/portal/FavouriteRooms";

export const runtime = "nodejs";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const [user, upcomingCount, allRooms] = await Promise.all([
    db.user.findUnique({ where: { upn: session.upn } }),
    db.booking.count({
      where: { organiserUpn: session.upn, endUtc: { gt: new Date() } },
    }),
    db.room.findMany({
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, kind: true, bookable: true },
    }),
  ]);

  const visibleRooms = allRooms
    .filter(
      (r) =>
        r.kind !== "MINIBUS" &&
        r.kind !== "PARKING" &&
        r.kind !== "PARKING_BAY" &&
        canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, r, true),
    )
    .map((r) => ({ id: r.id, displayName: r.displayName }));

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">Profile</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{session.displayName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{session.upn}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <div className="flex gap-1">
                {session.isAdmin && <Badge>Admin</Badge>}
                {session.isStaff && <Badge variant="secondary">Staff</Badge>}
                {!session.isStaff && !session.isAdmin && <Badge variant="outline">Student</Badge>}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Upcoming bookings</span>
              <Link
                href="/bookings"
                className="text-primary underline-offset-2 hover:underline font-medium"
              >
                {upcomingCount}
              </Link>
            </div>
            {user?.lastLoginAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last sign-in</span>
                <span>
                  {new Intl.DateTimeFormat("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Europe/London",
                  }).format(user.lastLoginAt)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <FavouriteRooms rooms={visibleRooms} />

        <form action="/api/auth/logout" method="POST" className="mt-6">
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-full border border-outline-variant text-on-surface-variant hover:border-destructive hover:text-destructive transition-colors"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              logout
            </span>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

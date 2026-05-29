import Link from "next/link";
import { getServerSession } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const runtime = "nodejs";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const user = await db.user.findUnique({ where: { upn: session.upn } });

  return (
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

      <p className="mt-4 text-sm text-muted-foreground">
        View{" "}
        <Link href="/bookings" className="text-primary underline-offset-2 hover:underline">
          your bookings
        </Link>
      </p>
    </div>
  );
}

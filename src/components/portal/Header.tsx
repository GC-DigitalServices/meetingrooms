import Link from "next/link";
import { CalendarDays } from "lucide-react";
import AccountMenu from "./AccountMenu";
import type { Session } from "@/lib/auth/session";

interface Props {
  session: Session;
}

export default function Header({ session }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center gap-4 px-4 max-w-7xl">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <CalendarDays className="h-5 w-5 text-primary" />
          <span>Room Booking</span>
        </Link>

        <nav className="flex items-center gap-4 text-sm ml-2">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Rooms
          </Link>
          <Link
            href="/bookings"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            My Bookings
          </Link>
          {session.isAdmin && (
            <Link
              href="/admin"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto">
          <AccountMenu
            session={{
              displayName: session.displayName,
              upn: session.upn,
              isAdmin: session.isAdmin,
            }}
          />
        </div>
      </div>
    </header>
  );
}

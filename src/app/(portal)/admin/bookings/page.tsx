import Link from "next/link";
import { BookingSearch } from "./BookingSearch";

export const dynamic = "force-dynamic";

export default function AdminBookingsPage() {
  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="max-w-3xl">
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Admin
        </Link>
        <h1 className="font-display font-extrabold text-headline-xl text-on-background mt-2 mb-2">
          Bookings
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Search and delete any booking — meeting rooms, minibus and visitor car park.
        </p>
        <BookingSearch />
      </div>
    </div>
  );
}

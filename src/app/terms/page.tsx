import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { getConfig } from "@/lib/config";

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  // Already accepted — skip this page
  if (session.termsAccepted) {
    const { next } = await searchParams;
    redirect(next && next.startsWith("/") ? next : "/");
  }

  const { next } = await searchParams;
  const actionUrl = `/api/auth/accept-terms${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-xl w-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terms of use</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Please read and accept before continuing.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-sm text-card-foreground">
          <p>
            The <strong>Room Booking Platform</strong> is provided by Greenhead College IT
            Services for the purpose of reserving meeting rooms and shared spaces.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Use of this system is subject to Greenhead College&apos;s{" "}
              <strong>Acceptable Use Policy</strong>. Rooms must be booked for
              legitimate college business only.
            </li>
            <li>
              Your booking activity (room, time, organiser name) is recorded and
              may be reviewed by IT administrators and line managers for
              safeguarding, facilities planning, and audit purposes.
            </li>
            <li>
              Unused bookings should be cancelled promptly to free space for
              colleagues.
            </li>
            <li>
              Misuse of the booking system (e.g. blocking rooms speculatively)
              may result in your access being suspended.
            </li>
          </ul>
        </div>

        <form action={actionUrl} method="POST">
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            I accept — continue to the booking portal
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground">
          Signed in as {session.displayName} ({session.upn})
        </p>
      </div>
    </div>
  );
}

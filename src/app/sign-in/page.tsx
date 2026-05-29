import Link from "next/link";
import { CalendarDays, AlertCircle } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Something went wrong with the sign-in request. Please try again.",
  invalid_state: "The sign-in session expired. Please try again.",
  token_exchange: "Could not complete sign-in with Microsoft. Please try again.",
  graph_fetch: "Could not retrieve your account details. Please try again.",
  access_denied: "Access was denied. Contact your administrator if you think this is a mistake.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; auth_error?: string }>;
}) {
  const { next, auth_error } = await searchParams;
  const loginHref = next
    ? `/api/auth/login?next=${encodeURIComponent(next)}`
    : "/api/auth/login";

  const errorMsg = auth_error ? (ERROR_MESSAGES[auth_error] ?? "An error occurred. Please try again.") : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">Room Booking</h1>
          <p className="text-muted-foreground mt-1 text-sm">Greenhead College</p>
        </div>

        <div className="bg-background rounded-xl border shadow-sm p-6 space-y-4">
          {errorMsg && (
            <div className="flex gap-2 items-start rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <p className="text-sm text-muted-foreground text-center">
            Sign in with your Greenhead Microsoft account to book rooms.
          </p>

          <Link
            href={loginHref}
            className="flex items-center justify-center gap-3 w-full rounded-md border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden>
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </Link>
        </div>
      </div>
    </div>
  );
}

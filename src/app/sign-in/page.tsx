import Link from "next/link";

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Something went wrong with the sign-in request. Please try again.",
  invalid_state: "The sign-in session expired. Please try again.",
  token_exchange: "Could not complete sign-in with Microsoft. Please try again.",
  graph_fetch: "Could not retrieve your account details. Please try again.",
  access_denied: "Access was denied. Contact IT Support if you believe this is a mistake.",
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
  const errorMsg = auth_error
    ? (ERROR_MESSAGES[auth_error] ?? "An error occurred. Please try again.")
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-primary text-on-primary px-margin-mobile md:px-margin-desktop py-4 shadow-sm">
        <span className="font-display font-extrabold text-headline-md">Greenhead College</span>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-margin-mobile">
        <div className="w-full max-w-md">
          {/* Hero text */}
          <div className="text-center mb-lg">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-md">
              <span className="material-symbols-outlined text-4xl text-primary">meeting_room</span>

            </div>
            <h1 className="font-display font-extrabold text-headline-lg text-on-background mb-2">
              Meeting Room Booking
            </h1>
            <p className="text-body-md text-on-surface-variant">
              Sign in with your Greenhead College Microsoft account to find and book spaces.
            </p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-xl border border-surface-container-highest shadow-card p-lg space-y-md">
            {errorMsg && (
              <div className="flex gap-2 items-start rounded-xl bg-error-container text-on-error-container px-md py-3 text-label-md font-label-md">
                <span className="material-symbols-outlined text-base mt-0.5 shrink-0">error</span>
                {errorMsg}
              </div>
            )}

            <Link
              href={loginHref}
              className="flex items-center justify-center gap-3 w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-label-md font-label-md text-on-background hover:bg-surface-container transition-colors"
            >
              {/* Microsoft logo */}
              <svg viewBox="0 0 21 21" className="h-5 w-5 shrink-0" aria-hidden>
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </Link>

            <p className="text-label-sm font-label-sm text-on-surface-variant text-center">
              Use your <strong>@greenhead.ac.uk</strong> account
            </p>
          </div>

          <p className="text-center mt-md text-label-sm font-label-sm text-on-surface-variant">
            Need help?{" "}
            <a href="mailto:it@greenhead.ac.uk" className="text-primary hover:underline">
              Contact IT Support
            </a>
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-primary text-on-primary px-margin-mobile md:px-margin-desktop py-md text-center">
        <p className="text-label-sm font-label-sm text-on-primary/70">
          © 2025 Greenhead College. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

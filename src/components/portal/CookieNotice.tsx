"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "mrbs:cookie-notice-dismissed";

export default function CookieNotice() {
  // Default true to avoid a flash on page load; useEffect sets the real value.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(!!localStorage.getItem(STORAGE_KEY));
  }, []);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background shadow-md lg:ml-64">
      <div className="flex items-center justify-between gap-4 px-margin-mobile md:px-margin-desktop py-3">
        <p className="text-sm text-muted-foreground">
          This site uses a single session cookie to keep you signed in. No
          tracking or analytics.{" "}
          <a href="/privacy" className="underline hover:text-foreground">
            Privacy notice
          </a>
        </p>
        <button
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, "1");
            setDismissed(true);
          }}
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

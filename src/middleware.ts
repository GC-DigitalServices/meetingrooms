import { NextRequest, NextResponse } from "next/server";

// Paths that never require a session cookie.
// API routes that use device-token auth handle auth in the route handler.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/terms",          // ToU page — auth checked inside the page, not via session cookie redirect
  "/api/auth/",
  "/api/health",
  "/api/qr",
  "/api/devices/",   // device-auth'd routes handle their own auth
  "/api/webhooks/",  // Graph validation requests arrive with no session cookie
  "/display",        // device-token auth, no session cookie
  "/_next/",
  "/favicon.ico",
];

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------
// script-src: nonce + strict-dynamic — no unsafe-inline, no unsafe-eval.
// style-src: unsafe-inline is required because React renders inline style=""
//   attributes (e.g. DisplayClient's dynamic colour theming) and Next.js
//   may inject <style> blocks for CSS-in-JS in dev. The critical restriction
//   is on scripts, where unsafe-inline enables XSS.
// img-src: includes the Greenhead CDN for the display logo and data: for
//   any base64-encoded images (QR code canvas fallback paths).
// worker-src: covers the /sw.js service worker.
// ---------------------------------------------------------------------------

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://www.greenhead.ac.uk",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Auth redirect — must happen before the nonce allocation so redirects
  // don't waste a nonce, and so the redirect itself carries no stale headers.
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.cookies.get("session")?.value) {
    // Attempt silent SSO first — if the user is already signed into O365 in this
    // browser, Azure AD will return a code immediately and they land on their page
    // without ever seeing the sign-in screen. If not, the callback falls back to
    // /sign-in where they can click the button.
    const url = req.nextUrl.clone();
    url.pathname = "/api/auth/login";
    url.searchParams.set("next", pathname);
    url.searchParams.set("prompt", "none");
    return NextResponse.redirect(url);
  }

  // Per-request nonce. Forwarded on the request so Next.js applies it to
  // its internal RSC streaming scripts; also readable by server components
  // via headers() if any explicit <Script nonce={nonce}> is ever needed.
  const nonce = btoa(crypto.randomUUID());
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  // HSTS — only in production (TLS is terminated upstream by the platform).
  // Avoid sending it over plain-HTTP local dev where it would pin localhost.
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

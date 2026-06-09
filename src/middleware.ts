import { NextRequest, NextResponse } from "next/server";

// Paths that never require a session cookie.
// API routes that use device-token auth handle auth in the route handler.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/api/auth/",
  "/api/health",
  "/api/qr",
  "/api/devices/",   // device-auth'd routes handle their own auth
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
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
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

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

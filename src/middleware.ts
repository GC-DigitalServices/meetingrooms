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

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionId = req.cookies.get("session")?.value;
  if (!sessionId) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

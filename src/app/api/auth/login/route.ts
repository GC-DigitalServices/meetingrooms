import { NextResponse } from "next/server";
import { getMsalApp, getCryptoProvider, SIGN_IN_SCOPES } from "@/lib/auth/msal";
import { getRedisClient } from "@/lib/realtime/redis";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

// Stores PKCE verifier in Redis keyed by state. TTL 10 minutes.
const STATE_TTL_S = 600;

export async function GET(req: Request): Promise<Response> {
  const { PUBLIC_BASE_URL } = getConfig();
  const redirectUri = `${PUBLIC_BASE_URL}/api/auth/callback`;

  const { searchParams } = new URL(req.url);

  // Preserve the intended destination through the OAuth round-trip.
  const next = searchParams.get("next") ?? "/";

  // prompt=none is set by the middleware for automatic silent SSO. Azure AD will
  // return a code immediately if the user has an active O365 session, or return
  // interaction_required which the callback converts to a normal /sign-in redirect.
  const prompt = searchParams.get("prompt") === "none" ? "none" : undefined;

  const { verifier, challenge } = await getCryptoProvider().generatePkceCodes();
  const state = globalThis.crypto.randomUUID();

  await getRedisClient().set(
    `auth:state:${state}`,
    JSON.stringify({ verifier, next }),
    "EX",
    STATE_TTL_S
  );

  const authUrl = await getMsalApp().getAuthCodeUrl({
    scopes: SIGN_IN_SCOPES,
    redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state,
    domainHint: "greenhead.ac.uk",
    ...(prompt && { prompt }),
  });

  return NextResponse.redirect(authUrl);
}

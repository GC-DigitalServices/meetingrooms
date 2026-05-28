import { NextRequest, NextResponse } from "next/server";
import { getMsalApp, SIGN_IN_SCOPES } from "@/lib/auth/msal";
import { getRedisClient } from "@/lib/realtime/redis";
import { createSession } from "@/lib/auth/session";
import { loadGroups } from "@/lib/config/groups-loader";
import { db } from "@/lib/db/client";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days browser-side

interface MeResponse {
  userPrincipalName: string;
  displayName: string;
}

interface MembershipPage {
  value: Array<{ id: string }>;
  "@odata.nextLink"?: string;
}

async function fetchAllGroupIds(accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  let url = "https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id&$top=100";

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Group fetch failed: ${res.status}`);
    const page = (await res.json()) as MembershipPage;
    ids.push(...page.value.map((m) => m.id));
    // Cap at 500 — more is a misconfiguration
    if (ids.length >= 500) break;
    url = page["@odata.nextLink"] ?? "";
  }

  return ids;
}

export async function GET(req: NextRequest): Promise<Response> {
  const { PUBLIC_BASE_URL } = getConfig();
  const redirectUri = `${PUBLIC_BASE_URL}/api/auth/callback`;
  const { searchParams } = new URL(req.url);

  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    logger.warn({ error, desc: searchParams.get("error_description") }, "auth: callback error from Microsoft");
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/?auth_error=missing_params`);
  }

  // Validate state + retrieve PKCE verifier
  const stateRaw = await getRedisClient().get(`auth:state:${state}`);
  if (!stateRaw) {
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/?auth_error=invalid_state`);
  }
  await getRedisClient().del(`auth:state:${state}`);
  const { verifier } = JSON.parse(stateRaw) as { verifier: string };

  let accessToken: string;
  try {
    const tokenResponse = await getMsalApp().acquireTokenByCode({
      code,
      scopes: SIGN_IN_SCOPES,
      redirectUri,
      codeVerifier: verifier,
    });
    accessToken = tokenResponse.accessToken;
  } catch (err) {
    logger.error({ err }, "auth: token exchange failed");
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/?auth_error=token_exchange`);
  }

  // Use delegated token exactly twice, then discard.
  let me: MeResponse;
  let groupIds: string[];
  try {
    const meRes = await fetch(
      "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,displayName",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!meRes.ok) throw new Error(`/me returned ${meRes.status}`);
    me = (await meRes.json()) as MeResponse;
    groupIds = await fetchAllGroupIds(accessToken);
  } catch (err) {
    logger.error({ err }, "auth: graph user fetch failed");
    return NextResponse.redirect(`${PUBLIC_BASE_URL}/?auth_error=graph_fetch`);
  }
  // accessToken is now out of scope and will be GC'd — not stored.

  const groups = loadGroups();
  const isStaff = groups.staff_groups.some((g) => groupIds.includes(g));
  const isAdmin = groupIds.includes(groups.admin_group);

  // Upsert user record
  await db.user.upsert({
    where:  { upn: me.userPrincipalName },
    create: { upn: me.userPrincipalName, displayName: me.displayName, isStaff, isAdmin, groupIds, lastLoginAt: new Date() },
    update: { displayName: me.displayName, isStaff, isAdmin, groupIds, lastLoginAt: new Date() },
  });

  const sessionId = await createSession({
    upn: me.userPrincipalName,
    displayName: me.displayName,
    groupIds,
    isStaff,
    isAdmin,
    signedInAt: Date.now(),
  });

  logger.info({ upn: me.userPrincipalName, isStaff, isAdmin }, "auth: sign-in success");

  const response = NextResponse.redirect(`${PUBLIC_BASE_URL}/`);
  response.cookies.set("session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

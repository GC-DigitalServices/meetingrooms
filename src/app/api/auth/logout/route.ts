import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const { PUBLIC_BASE_URL } = getConfig();
  const sessionId = req.cookies.get("session")?.value;

  if (sessionId) await deleteSession(sessionId);

  const response = NextResponse.redirect(`${PUBLIC_BASE_URL}/`, { status: 303 });
  response.cookies.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

import { NextRequest } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { graphClient } from "@/lib/graph/client";
import { apiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const res = await graphClient.getRawResponse(
    `/users/${encodeURIComponent(session.upn)}/photo/$value`
  );

  if (!res.ok) return new Response(null, { status: 404 });

  const buffer = await res.arrayBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

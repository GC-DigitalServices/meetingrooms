import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { renewExpiringSubscriptions } from "@/lib/graph/subscriptions";
import { apiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const result = await renewExpiringSubscriptions();
  return NextResponse.json(result);
}

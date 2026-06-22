import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { revokeUserSessions } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/audit";
import { apiError } from "@/lib/api/errors";
import { z } from "zod";

export const runtime = "nodejs";

const RevokeSchema = z.object({
  upn: z.string().email("upn must be a valid email/UPN"),
});

/**
 * POST /api/admin/sessions/revoke — admin force-logout for a user.
 * Kills every active session for the target UPN immediately. Use on
 * offboarding or when a role is downgraded outside the normal sign-in cycle.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid request body");
  }

  const parsed = RevokeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });
  }

  const count = await revokeUserSessions(parsed.data.upn);

  await writeAudit({
    actor: admin.upn,
    action: "session.revoke",
    targetId: parsed.data.upn,
    metadata: { revokedCount: count },
  });

  return NextResponse.json({ upn: parsed.data.upn, revokedCount: count });
}

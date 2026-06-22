import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { apiError } from "@/lib/api/errors";
import { loadGroups } from "@/lib/config/groups-loader";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const groups = loadGroups();

  const knownGroups = [
    ...groups.staff_groups.map((id, i) => ({
      id,
      label: groups.staff_groups.length === 1 ? "Staff group" : `Staff group ${i + 1}`,
    })),
    { id: groups.admin_group, label: "Admin group" },
  ];

  return NextResponse.json({ knownGroups });
}

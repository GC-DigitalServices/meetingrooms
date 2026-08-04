import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { apiError } from "@/lib/api/errors";
import { getManagedFile, MINIBUS_CHECKLIST_KEY } from "@/lib/db/managedFiles";

export const runtime = "nodejs";

/** GET /api/admin/minibus-checklist/file — admin download of the current checklist. */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const file = await getManagedFile(MINIBUS_CHECKLIST_KEY);
  if (!file) return apiError("NOT_FOUND", "No checklist has been uploaded yet");

  const body = new Uint8Array(file.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
      "Content-Length": String(file.size),
    },
  });
}

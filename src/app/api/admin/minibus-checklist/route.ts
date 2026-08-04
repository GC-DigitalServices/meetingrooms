import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { apiError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/db/audit";
import { getManagedFileMeta, putManagedFile, MINIBUS_CHECKLIST_KEY } from "@/lib/db/managedFiles";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — kept small enough to attach inline to email

// Accepted document types. Value is the canonical content type stored/sent.
const ALLOWED: Record<string, string> = {
  "application/pdf": "application/pdf",
  "application/msword": "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const EXT_FALLBACK: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function guard(req: NextRequest) {
  try {
    return await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await guard(req);
  if (session instanceof Response) return session;

  const meta = await getManagedFileMeta(MINIBUS_CHECKLIST_KEY);
  return NextResponse.json(meta);
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await guard(req);
  if (session instanceof Response) return session;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("VALIDATION_ERROR", "Expected a multipart file upload");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return apiError("VALIDATION_ERROR", "No file uploaded");
  }
  if (file.size > MAX_BYTES) {
    return apiError("VALIDATION_ERROR", "File too large — maximum 4 MB");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = ALLOWED[file.type] ?? EXT_FALLBACK[ext];
  if (!contentType) {
    return apiError("VALIDATION_ERROR", "Unsupported file type — upload a PDF or Word document");
  }

  const data = Buffer.from(await file.arrayBuffer());
  const meta = await putManagedFile({
    key: MINIBUS_CHECKLIST_KEY,
    filename: file.name,
    contentType,
    data,
    uploadedBy: session.upn,
  });

  await writeAudit({
    actor: session.upn,
    action: "minibus_checklist.upload",
    targetId: MINIBUS_CHECKLIST_KEY,
    metadata: { filename: meta.filename, size: meta.size, contentType },
  });

  return NextResponse.json(meta, { status: 201 });
}

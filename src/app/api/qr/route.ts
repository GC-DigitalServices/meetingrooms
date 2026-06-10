import { NextRequest } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const data = req.nextUrl.searchParams.get("data");
  if (!data) return new Response("Missing data parameter", { status: 400 });
  // Cap input — a QR for our booking deep-links is well under this. Prevents
  // using this unauthenticated endpoint as a CPU-bound oracle for huge payloads.
  if (data.length > 512) return new Response("data too long", { status: 413 });

  const svg = await QRCode.toString(data, {
    type: "svg",
    errorCorrectionLevel: "L",
    margin: 1,
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    },
  });
}

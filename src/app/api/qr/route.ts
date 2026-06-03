import { NextRequest } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const data = req.nextUrl.searchParams.get("data");
  if (!data) return new Response("Missing data parameter", { status: 400 });

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

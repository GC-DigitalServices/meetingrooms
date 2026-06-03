import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/qr?data=<url-encoded-string>
 * Returns a QR code SVG for the given data string.
 *
 * TODO: pnpm add qrcode @types/qrcode
 * Once installed, uncomment the implementation below.
 *
 * import QRCode from "qrcode";
 * const svg = await QRCode.toString(data, { type: "svg", errorCorrectionLevel: "L", margin: 1 });
 * return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
 */
export async function GET(req: NextRequest): Promise<Response> {
  const data = req.nextUrl.searchParams.get("data");
  if (!data) return NextResponse.json({ error: "Missing data parameter" }, { status: 400 });

  // Stub: return a placeholder SVG until qrcode package is installed.
  // The display page handles image load failure gracefully (shows fallback URL text).
  const escaped = data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="white"/>
  <rect x="10" y="10" width="180" height="180" fill="none" stroke="#003a35" stroke-width="4" stroke-dasharray="8,4"/>
  <text x="100" y="85" font-family="system-ui" font-size="12" fill="#003a35" text-anchor="middle">QR code</text>
  <text x="100" y="105" font-family="system-ui" font-size="10" fill="#666" text-anchor="middle">pending install</text>
  <text x="100" y="125" font-family="monospace" font-size="7" fill="#003a35" text-anchor="middle">${escaped.slice(0, 40)}</text>
</svg>`;

  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
  });
}

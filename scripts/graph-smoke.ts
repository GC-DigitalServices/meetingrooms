/**
 * Graph smoke test — Phase 1 exit-criterion artefact.
 *
 * Authenticates with app credentials and lists events from a room mailbox
 * for the next 7 days. Verifies that:
 *   1. App credentials are valid and a token can be acquired.
 *   2. The Application Access Policy allows access to the given mailbox.
 *   3. Graph returns events (or "(no events)" if the calendar is empty).
 *
 * Usage:
 *   pnpm smoke <room-mailbox-upn>
 *   e.g. pnpm smoke b12@college.ac.uk
 *
 * Requires .env.local with AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
 */

// Load .env.local before anything else
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv(); // fallback to .env

import { ConfidentialClientApplication } from "@azure/msal-node";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function acquireAppToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing required env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.\n" +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }

  const msalClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });

  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });

  if (!result?.accessToken) {
    throw new Error("MSAL returned no access token. Check credentials and tenant ID.");
  }

  return result.accessToken;
}

// ---------------------------------------------------------------------------
// HTTP with retry/backoff
// ---------------------------------------------------------------------------

async function graphGet(url: string, token: string, attempt = 1): Promise<unknown> {
  const MAX_ATTEMPTS = 4;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (res.ok) {
    return res.json();
  }

  const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);

  if (isRetryable && attempt < MAX_ATTEMPTS) {
    // Respect Retry-After header if present; otherwise exponential backoff
    const retryAfterHeader = res.headers.get("Retry-After");
    const delaySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.pow(2, attempt);
    console.warn(`  HTTP ${res.status} — retrying in ${delaySec}s (attempt ${attempt}/${MAX_ATTEMPTS - 1})`);
    await new Promise((r) => setTimeout(r, delaySec * 1000));
    return graphGet(url, token, attempt + 1);
  }

  const body = await res.text().catch(() => "(no body)");
  throw new Error(`Graph HTTP ${res.status}: ${body}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  iCalUId: string;
}

interface CalendarViewResponse {
  value: CalendarEvent[];
  "@odata.nextLink"?: string;
}

async function main() {
  const mailboxUpn = process.argv[2];

  if (!mailboxUpn) {
    console.error("Usage: pnpm smoke <room-mailbox-upn>");
    console.error("  e.g. pnpm smoke b12@college.ac.uk");
    process.exit(1);
  }

  console.log(`\n🔑  Acquiring app token for tenant ${process.env.AZURE_TENANT_ID} ...`);
  const token = await acquireAppToken();
  console.log("✅  Token acquired\n");

  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(mailboxUpn)}/calendarView` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${end.toISOString()}` +
    `&$select=id,subject,start,end,iCalUId` +
    `&$orderby=start/dateTime` +
    `&$top=20`;

  console.log(`📅  Listing events for ${mailboxUpn} (next 7 days) ...\n`);

  const data = (await graphGet(url, token)) as CalendarViewResponse;

  if (!data.value?.length) {
    console.log("  (no events in this window)\n");
    console.log("✅  Smoke test passed — mailbox is accessible, calendar is empty.");
    return;
  }

  console.log(`Found ${data.value.length} event(s):\n`);

  for (const event of data.value) {
    const startLocal = new Date(event.start.dateTime + "Z").toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "short",
      timeStyle: "short",
    });
    const endLocal = new Date(event.end.dateTime + "Z").toLocaleString("en-GB", {
      timeZone: "Europe/London",
      timeStyle: "short",
    });
    console.log(`  📌  ${event.subject}`);
    console.log(`      ${startLocal} – ${endLocal}`);
    console.log(`      iCalUId: ${event.iCalUId}\n`);
  }

  if (data["@odata.nextLink"]) {
    console.log("  (more events exist beyond the first 20)\n");
  }

  console.log("✅  Smoke test passed — app credentials and Application Access Policy are working.");
}

main().catch((err: unknown) => {
  console.error("\n❌  Smoke test failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

/**
 * Room-day diagnostic — what Exchange holds vs what our cache holds.
 *
 * Read-only. Written while chasing a room that read busy all day when its
 * calendar showed a single 12:35–13:35 lesson: Salamander had published the
 * whole term as one continuous event. Nothing in the code could have told us
 * that; only the two sides side by side could.
 *
 * Prints `type`, `isAllDay`, `showAs` and `iCalUId` per event, because the
 * usual suspects for "the times don't match" are a series master mirrored in
 * place of its occurrences, an event marked Free, and occurrences sharing one
 * iCalUId (which the unique constraint would collapse onto a single row).
 *
 * Usage:
 *   pnpm diag:room <room-mailbox-upn> <YYYY-MM-DD>
 *   e.g. pnpm diag:room g17@greenhead.ac.uk 2026-09-15
 *
 * Requires .env.local with AZURE_TENANT_ID, AZURE_CLIENT_ID,
 * AZURE_CLIENT_SECRET and DATABASE_URL.
 */

// Load .env.local before anything else
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv(); // fallback to .env

import { ConfidentialClientApplication } from "@azure/msal-node";
import { PrismaClient } from "@prisma/client";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const ORGANISER_UPN_PROP_ID =
  "String {00000000-0000-0000-0000-000000000001} Name OrganiserUpn";
const SOURCE_PROP_ID = "String {00000000-0000-0000-0000-000000000002} Name Source";

const [mailbox, day] = process.argv.slice(2);
if (!mailbox || !day) {
  console.error("usage: pnpm diag:room <room-mailbox-upn> <YYYY-MM-DD>");
  process.exit(1);
}

async function acquireAppToken(): Promise<string> {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID!,
      clientSecret: process.env.AZURE_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    },
  });
  const result = await app.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("MSAL returned no access token");
  return result.accessToken;
}

const london = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);

interface RawEvent {
  iCalUId: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  type?: string;
  showAs?: string;
}

async function main() {
  // A day either side, so an event straddling the edges — the whole point of
  // this script the first time it was needed — still shows up.
  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${day}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/calendarView` +
    `?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}` +
    `&$top=250` +
    `&$select=id,iCalUId,subject,start,end,isAllDay,type,seriesMasterId,showAs,organizer,attendees` +
    `&$expand=singleValueExtendedProperties($filter=id eq '${ORGANISER_UPN_PROP_ID}' or id eq '${SOURCE_PROP_ID}')`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await acquireAppToken()}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) throw new Error(`Graph HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { value: RawEvent[] };

  console.log(`\n=== EXCHANGE (${mailbox}) ${from.toISOString()} -> ${to.toISOString()} ===`);
  for (const e of body.value) {
    console.log(
      [
        `${e.start.dateTime} (${e.start.timeZone})`,
        `-> ${e.end.dateTime}`,
        `allDay=${e.isAllDay}`,
        `type=${e.type}`,
        `showAs=${e.showAs}`,
        `uid=${e.iCalUId}`,
        `subj=${JSON.stringify(e.subject)}`,
      ].join("  "),
    );
  }
  if (!body.value.length) console.log("(none)");

  const db = new PrismaClient();
  const room = await db.room.findFirst({
    where: { mailboxUpn: { equals: mailbox, mode: "insensitive" } },
    select: { id: true, displayName: true, kind: true, parentRoomId: true },
  });
  console.log(`\n=== ROOM ROW ===`);
  console.log(room ?? "(no room with that mailbox)");

  if (room) {
    // Include the parent so a section's whole-room bookings show up too.
    const roomIds = [room.id, ...(room.parentRoomId ? [room.parentRoomId] : [])];
    const rows = await db.booking.findMany({
      where: { roomId: { in: roomIds }, startUtc: { lt: to }, endUtc: { gt: from } },
      orderBy: { startUtc: "asc" },
    });
    console.log(`\n=== CACHE (${rows.length} rows) ===`);
    for (const b of rows) {
      console.log(
        [
          `${london(b.startUtc)} -> ${london(b.endUtc)}`,
          `allDay=${b.isAllDay}`,
          `src=${b.source}`,
          `room=${b.roomId}`,
          `uid=${b.graphICalUid}`,
          `subj=${JSON.stringify(b.subject)}`,
        ].join("  "),
      );
    }
    if (!rows.length) console.log("(none)");
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

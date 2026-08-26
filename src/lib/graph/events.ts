import { graphClient } from "@/lib/graph/client";
import { ORGANISER_UPN_PROP_ID, SOURCE_PROP_ID } from "@/lib/graph/sync";
import type { GraphEvent } from "@/lib/graph/types";

export const BOOKING_ID_PROP_ID =
  "String {00000000-0000-0000-0000-000000000003} Name BookingId";

export interface CreateEventInput {
  organiserUpn: string;
  organiserName: string;
  subject: string;
  startUtc: Date;
  endUtc: Date;
  resourceMailboxes: string[]; // invited as type=resource
  source: "PORTAL" | "IPAD_QR";
  bookingId: string;
  /** When true, the organiser is NOT added as an attendee — no calendar invite is sent. */
  skipOrganiserInvite?: boolean;
}

function utcString(d: Date): string {
  // Graph expects ISO without trailing Z when timeZone="UTC" is set separately.
  return d.toISOString().replace("Z", "");
}

/**
 * Creates a calendar event in the primary mailbox (first element of
 * resourceMailboxes) with all resource mailboxes as attendees.
 * For composite rooms, all section mailboxes are passed as resources —
 * Exchange auto-accepts them all.
 */
export async function createGraphEvent(
  primaryMailbox: string,
  input: CreateEventInput
): Promise<GraphEvent> {
  return graphClient.post<GraphEvent>(
    `/users/${encodeURIComponent(primaryMailbox)}/calendar/events`,
    {
      subject: `${input.organiserName} — ${input.subject}`,
      start: { dateTime: utcString(input.startUtc), timeZone: "UTC" },
      end:   { dateTime: utcString(input.endUtc),   timeZone: "UTC" },
      attendees: [
        ...input.resourceMailboxes.map((upn) => ({
          emailAddress: { address: upn },
          type: "resource",
        })),
        ...(input.skipOrganiserInvite ? [] : [{
          emailAddress: { address: input.organiserUpn, name: input.organiserName },
          type: "required",
        }]),
      ],
      singleValueExtendedProperties: [
        { id: ORGANISER_UPN_PROP_ID, value: input.organiserUpn },
        { id: SOURCE_PROP_ID,        value: input.source },
        { id: BOOKING_ID_PROP_ID,    value: input.bookingId },
      ],
    }
  );
}

export interface UpdateEventInput {
  organiserName?: string;
  subject?: string;
  startUtc?: Date;
  endUtc?: Date;
}

export async function updateGraphEvent(
  primaryMailbox: string,
  graphEventId: string,
  input: UpdateEventInput
): Promise<GraphEvent> {
  const body: Record<string, unknown> = {};

  if (input.subject !== undefined && input.organiserName !== undefined) {
    body.subject = `${input.organiserName} — ${input.subject}`;
  }
  if (input.startUtc !== undefined) {
    body.start = { dateTime: utcString(input.startUtc), timeZone: "UTC" };
  }
  if (input.endUtc !== undefined) {
    body.end = { dateTime: utcString(input.endUtc), timeZone: "UTC" };
  }

  return graphClient.patch<GraphEvent>(
    `/users/${encodeURIComponent(primaryMailbox)}/events/${graphEventId}`,
    body
  );
}

export async function deleteGraphEvent(
  primaryMailbox: string,
  graphEventId: string
): Promise<void> {
  await graphClient.delete(
    `/users/${encodeURIComponent(primaryMailbox)}/events/${graphEventId}`
  );
}

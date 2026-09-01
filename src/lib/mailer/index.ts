import { graphClient } from "@/lib/graph/client";
import { getConfig } from "@/lib/config";
import { loadGroups } from "@/lib/config/groups-loader";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/db/audit";
import { getManagedFile, MINIBUS_CHECKLIST_KEY } from "@/lib/db/managedFiles";
import { createHash } from "crypto";

export type NotifyAction = "CREATE" | "UPDATED" | "CANCELLED";

export interface PremisesNotifyParams {
  bookingId: string;
  action: NotifyAction;
  organiserName: string;
  roomDisplayName: string;
  roomKind: string;
  startLocal: string;
  endLocal: string;
  premisesNotes: string | null;
  portalUrl: string;
  actorUpn: string;
  /**
   * Set for a weekly series: one email covers the whole run rather than one per
   * occurrence. `startLocal`/`endLocal` stay the first occurrence's, so the
   * subject still leads with a date. `skipped` lists the weeks that lost the
   * conflict check and were never booked — premises need to know a date they
   * might otherwise prepare for is not happening.
   */
  occurrences?: { startLocal: string; endLocal: string }[];
  skipped?: string[];
}

function formatLocal(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export { formatLocal };

/**
 * Computes a SHA-256 hash of the fields that trigger a premises notification.
 * Used for idempotency — only send if the hash has changed since last send.
 */
export function computePremisesHash(fields: {
  roomId: string;
  organiserUpn: string;
  startUtc: Date;
  endUtc: Date;
  premisesNotes: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        r: fields.roomId,
        o: fields.organiserUpn,
        s: fields.startUtc.toISOString(),
        e: fields.endUtc.toISOString(),
        n: fields.premisesNotes ?? "",
      })
    )
    .digest("hex");
}

/**
 * Returns true if a premises notification should fire.
 * MINIBUS: always. Other rooms: only if premisesNotes is non-empty.
 */
export function shouldNotifyPremises(roomKind: string, premisesNotes: string | null | undefined): boolean {
  if (roomKind === "MINIBUS") return true;
  return !!premisesNotes?.trim();
}

/**
 * Sends a premises notification email via Graph sendMail.
 * Failures are caught, logged, and written to the audit log — they NEVER
 * roll back the booking.
 */
/**
 * Sends a plain-text operational alert to the admin_alert_email configured in
 * groups.yaml. Failures are logged but never thrown — alerts must not cascade.
 */
export async function sendAdminAlert(subject: string, body: string): Promise<void> {
  const { MAIL_SENDER_UPN } = getConfig();
  if (!MAIL_SENDER_UPN) {
    logger.warn("mailer: MAIL_SENDER_UPN not configured, skipping admin alert");
    return;
  }

  const groups = loadGroups();
  if (!groups.admin_alert_email) {
    logger.warn("mailer: admin_alert_email not set in groups.yaml, skipping alert");
    return;
  }

  try {
    await graphClient.post(
      `/users/${encodeURIComponent(MAIL_SENDER_UPN)}/sendMail`,
      {
        message: {
          subject: `[Room Booking Alert] ${subject}`,
          body: { contentType: "Text", content: body },
          toRecipients: [{ emailAddress: { address: groups.admin_alert_email } }],
        },
        saveToSentItems: false,
      }
    );
    logger.info({ subject }, "mailer: admin_alert_sent");
  } catch (err) {
    logger.error({ subject, err }, "mailer: admin_alert_failed");
  }
}

export async function sendParkingConfirmation(params: {
  bookingId: string;
  organiserUpn: string;
  organiserName: string;
  poolDisplayName: string;
  startUtc: Date;
  endUtc: Date;
  portalUrl: string;
}): Promise<void> {
  const { MAIL_SENDER_UPN } = getConfig();
  if (!MAIL_SENDER_UPN) return;

  const start = formatLocal(params.startUtc);
  const end   = formatLocal(params.endUtc);

  const body = [
    `Hi ${params.organiserName},`,
    ``,
    `Your visitor car park bay has been booked.`,
    ``,
    `Car Park: ${params.poolDisplayName}`,
    `Date/Time: ${start} – ${end.split(", ")[1] ?? end}`,
    ``,
    `To cancel this booking, visit: ${params.portalUrl}/bookings`,
  ].join("\n");

  try {
    await graphClient.post(
      `/users/${encodeURIComponent(MAIL_SENDER_UPN)}/sendMail`,
      {
        message: {
          subject: `Visitor car park booking confirmed — ${start}`,
          body: { contentType: "Text", content: body },
          toRecipients: [{ emailAddress: { address: params.organiserUpn, name: params.organiserName } }],
        },
        saveToSentItems: false,
      }
    );
    logger.info({ bookingId: params.bookingId }, "mailer: parking_confirmation_sent");
  } catch (err) {
    logger.error({ bookingId: params.bookingId, err }, "mailer: parking_confirmation_failed");
  }
}

/**
 * Sends a booking confirmation to the staff member who booked a minibus. This
 * email is the booker's confirmation — minibus bookings do not add a calendar
 * invite. The safety-check checklist (admin-uploaded via Admin → Minibus
 * checklist) is attached when one exists; if none has been uploaded the email
 * is still sent, without the attachment. Best-effort — failures are logged,
 * never thrown, and never roll back the booking.
 */
export async function sendMinibusConfirmation(params: {
  bookingId: string;
  organiserUpn: string;
  organiserName: string;
  minibusDisplayName: string;
  startUtc: Date;
  endUtc: Date;
  portalUrl: string;
}): Promise<void> {
  const { MAIL_SENDER_UPN } = getConfig();
  if (!MAIL_SENDER_UPN) {
    logger.warn("mailer: MAIL_SENDER_UPN not configured, skipping minibus confirmation");
    return;
  }

  const checklist = await getManagedFile(MINIBUS_CHECKLIST_KEY);

  const start = formatLocal(params.startUtc);
  const end   = formatLocal(params.endUtc);

  const body = [
    `Hi ${params.organiserName},`,
    ``,
    `Your minibus booking is confirmed.`,
    ``,
    `Minibus: ${params.minibusDisplayName}`,
    `From: ${start}`,
    `To:   ${end}`,
    ``,
    checklist
      ? `The minibus safety-check checklist is attached. You must complete it on the day, before driving.`
      : `Remember to complete the minibus safety-check before driving.`,
    ``,
    `To view or cancel this booking, visit: ${params.portalUrl}/bookings`,
  ].join("\n");

  const message: Record<string, unknown> = {
    subject: `Minibus booking confirmed — ${start}`,
    body: { contentType: "Text", content: body },
    toRecipients: [{ emailAddress: { address: params.organiserUpn, name: params.organiserName } }],
  };
  if (checklist) {
    message.attachments = [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: checklist.filename,
        contentType: checklist.contentType,
        contentBytes: Buffer.from(checklist.data).toString("base64"),
      },
    ];
  }

  try {
    await graphClient.post(
      `/users/${encodeURIComponent(MAIL_SENDER_UPN)}/sendMail`,
      { message, saveToSentItems: false }
    );
    logger.info(
      { bookingId: params.bookingId, hasChecklist: !!checklist },
      "mailer: minibus_confirmation_sent"
    );
  } catch (err) {
    logger.error({ bookingId: params.bookingId, err }, "mailer: minibus_confirmation_failed");
  }
}

export async function sendPremisesNotification(params: PremisesNotifyParams): Promise<void> {
  const { MAIL_SENDER_UPN } = getConfig();
  if (!MAIL_SENDER_UPN) {
    logger.warn("mailer: MAIL_SENDER_UPN not configured, skipping premises notification");
    return;
  }

  const groups = loadGroups();
  if (!groups.premises_email) {
    logger.warn("mailer: premises_email not set in groups.yaml, skipping notification");
    return;
  }

  const isMinibus = params.roomKind === "MINIBUS";
  const what = isMinibus ? "Minibus" : "Room";
  const occurrences = params.occurrences ?? [];
  const isSeries = occurrences.length > 0;

  const subject = isSeries
    ? isMinibus
      ? `[${params.action}] Minibus booking: ${params.organiserName}, ${occurrences.length} weekly bookings from ${params.startLocal}`
      : `[${params.action}] Room prep requested: ${params.roomDisplayName}, ${occurrences.length} weekly bookings from ${params.startLocal}`
    : isMinibus
      ? `[${params.action}] Minibus booking: ${params.organiserName}, ${params.startLocal} → ${params.endLocal}`
      : `[${params.action}] Room prep requested: ${params.roomDisplayName}, ${params.startLocal}`;

  const whenLines = isSeries
    ? [
        `Weekly series: ${occurrences.length} booking${occurrences.length === 1 ? "" : "s"}`,
        ...occurrences.map((o) => `  • ${o.startLocal} → ${o.endLocal}`),
        ...(params.skipped?.length
          ? [
              `\nNot booked, the ${what.toLowerCase()} was already taken:`,
              ...params.skipped.map((when) => `  • ${when}`),
            ]
          : []),
      ]
    : [`Start: ${params.startLocal}`, `End:   ${params.endLocal}`];

  const bodyLines = [
    `Organiser: ${params.organiserName}`,
    `${what}: ${params.roomDisplayName}`,
    ...whenLines,
    ...(params.premisesNotes ? [`\nNotes: ${params.premisesNotes}`] : []),
    `\nView booking: ${params.portalUrl}/bookings/${params.bookingId}`,
  ];

  try {
    await graphClient.post(
      `/users/${encodeURIComponent(MAIL_SENDER_UPN)}/sendMail`,
      {
        message: {
          subject,
          body: { contentType: "Text", content: bodyLines.join("\n") },
          toRecipients: [
            { emailAddress: { address: groups.premises_email } },
            ...(isMinibus && groups.minibus_email
              ? [{ emailAddress: { address: groups.minibus_email } }]
              : []),
          ],
        },
        saveToSentItems: false,
      }
    );
    logger.info(
      { bookingId: params.bookingId, action: params.action },
      "mailer: premises_notification_sent"
    );
  } catch (err) {
    logger.error(
      { bookingId: params.bookingId, action: params.action, err },
      "mailer: premises_email_failed"
    );
    await writeAudit({
      actor: params.actorUpn,
      action: "premises.notify.failed",
      targetId: params.bookingId,
      metadata: {
        action: params.action,
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});
    // Do NOT rethrow — mail failure must not affect the booking.
  }
}

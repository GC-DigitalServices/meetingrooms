import { graphClient } from "@/lib/graph/client";
import { getConfig } from "@/lib/config";
import { loadGroups } from "@/lib/config/groups-loader";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/db/audit";
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
export async function sendPremisesNotification(params: PremisesNotifyParams): Promise<void> {
  const { PREMISES_SENDER_UPN } = getConfig();
  if (!PREMISES_SENDER_UPN) {
    logger.warn("mailer: PREMISES_SENDER_UPN not configured, skipping premises notification");
    return;
  }

  const groups = loadGroups();
  if (!groups.premises_email) {
    logger.warn("mailer: premises_email not set in groups.yaml, skipping notification");
    return;
  }

  const isMinibus = params.roomKind === "MINIBUS";
  const subject = isMinibus
    ? `[${params.action}] Minibus booking: ${params.organiserName}, ${params.startLocal} → ${params.endLocal}`
    : `[${params.action}] Room prep requested: ${params.roomDisplayName}, ${params.startLocal}`;

  const bodyLines = [
    `Organiser: ${params.organiserName}`,
    `${isMinibus ? "Minibus" : "Room"}: ${params.roomDisplayName}`,
    `Start: ${params.startLocal}`,
    `End:   ${params.endLocal}`,
    ...(params.premisesNotes ? [`\nNotes: ${params.premisesNotes}`] : []),
    `\nView booking: ${params.portalUrl}/bookings/${params.bookingId}`,
  ];

  try {
    await graphClient.post(
      `/users/${encodeURIComponent(PREMISES_SENDER_UPN)}/sendMail`,
      {
        message: {
          subject,
          body: { contentType: "Text", content: bodyLines.join("\n") },
          toRecipients: [{ emailAddress: { address: groups.premises_email } }],
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

# Manual resync runbook

Triggers a full Graph → Postgres resync outside the normal nightly window.
The nightly cron runs `fullResync()` automatically at 02:00; this runbook is
for situations where that cadence is insufficient.

---

## When to use this runbook

| Situation | Why a resync is needed |
|---|---|
| Prolonged Graph API outage | Webhooks were down; events that arrived during the outage were never processed |
| Postgres restored from backup | The restored snapshot is stale; Exchange is the source of truth |
| New room mailbox added | Existing bookings in that mailbox are not in Postgres |
| Webhook subscription gap | Subscriptions expired before renewal ran; events were silently dropped |

**Do not** trigger a resync for routine issues (single missed webhook, booking
appears out of order). The nightly cron handles steady-state drift.

---

## Pre-conditions

1. **Graph API is healthy.** Check the
   [Microsoft 365 Service Health dashboard](https://admin.microsoft.com/Adminportal/Home#/servicehealth)
   and confirm the Calendar/Exchange workload shows no active incidents.
   Running `fullResync()` against a degraded API will produce partial results
   and may leave Postgres in a worse state than before.

2. **Postgres is reachable and the schema is current.** If you are recovering
   from a backup restore, confirm the restored database passes schema
   validation before resyncing:
   ```
   railway run npx prisma migrate status
   ```
   All migrations must show `Applied`.

3. **Webhook endpoint is reachable.** After the resync, Graph will continue
   sending notifications to `/api/webhooks/graph`. Confirm the public URL is
   resolving before proceeding.

4. **You have Railway access.** The resync is triggered by restarting the
   Railway service (see Procedure below). Confirm you can reach the Railway
   dashboard or have the Railway CLI installed and authenticated.

---

## Procedure

### Option A — restart the Railway service (preferred)

Restarting causes `startCronJobs()` to run on startup, which calls
`ensureSubscriptionsForAllRooms()`. The nightly cron (`0 2 * * *`) will then
run at the next scheduled time. To force the resync to happen immediately
rather than waiting until 02:00, use Option B.

1. Railway dashboard → your project → the `mrbs` service.
2. Click **Restart**.
3. Watch the deploy log. You should see within the first 30 seconds:
   ```
   cron: jobs scheduled (subscription renewal every 6h, full resync at 02:00, device check every 15m)
   ```
   and then subscription creation/confirmation lines for each bookable room.

Use this option when the primary concern is **missing subscriptions** (webhook
gap scenario). The data will be reconciled at 02:00.

---

### Option B — trigger `fullResync()` immediately via Railway one-off command

Railway supports one-off commands that run in an isolated container with the
same environment variables as the running service.

> **Note:** The codebase is TypeScript compiled by Next.js. You cannot run
> `ts-node` or bare `node` against source files in production. Instead, add a
> temporary admin API endpoint (see below) and call it over HTTPS.

#### B1. Add a temporary trigger endpoint

Create `app/api/admin/resync/route.ts` with the following content:

```ts
import { NextResponse } from "next/server";
import { fullResync } from "@/lib/graph/sync";
import { requireAdmin } from "@/lib/auth/admin";

export async function POST(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  // Fire-and-forget; returns immediately so the HTTP timeout is not hit.
  fullResync().catch((err) =>
    console.error("manual resync failed", err)
  );

  return NextResponse.json({ started: true });
}
```

Deploy the change. The endpoint requires an authenticated admin session
(enforced by `requireAdmin`).

#### B2. Trigger the resync

```bash
curl -X POST https://<your-railway-domain>/api/admin/resync \
  -H "Cookie: <session-cookie>"
```

Or navigate to the URL in a browser while signed in as an admin and send the
POST via the browser console:

```js
fetch("/api/admin/resync", { method: "POST" }).then(r => r.json()).then(console.log)
```

Expected response: `{ "started": true }`

#### B3. Remove the temporary endpoint

Once the resync is confirmed complete (see Verification below), delete the
file and redeploy. Do not leave open admin endpoints in production.

---

## Verification

### 1. Check the Railway log

A successful resync produces a `graph: resync_completed` log line:

```
graph: resync_completed rooms=8 added=12 updated=47 removed=0 errors=0
```

Key fields:

| Field | Meaning |
|---|---|
| `rooms` | Number of non-composite mailbox rooms processed |
| `added` | Net-new bookings written to Postgres |
| `updated` | Existing bookings refreshed |
| `removed` | Bookings in Postgres that are no longer in Exchange (deleted) |
| `errors` | Mailboxes that returned a Graph error — check per-room log lines above |

`errors > 0` means one or more mailboxes failed. Scroll up in the log to find
`graph: resync failed for room` entries and note the `roomId`. The resync
continues for remaining rooms even when individual ones fail.

### 2. Check the admin status page

Navigate to `/admin/status` while signed in as an admin. Confirm:

- All rooms show an active subscription with an expiry date in the future.
- Booking counts per room look plausible (non-zero for rooms that have
  upcoming bookings in Exchange).

### 3. Spot-check a known booking

Pick a booking visible in the Exchange admin centre (or Outlook) for one of
the affected rooms and confirm it appears correctly in the MRBS portal:

- Correct room, time, organiser display name.
- Status colour matches (free / busy / soon).

---

## Post-resync checks

### After a Graph outage

- Confirm subscription renewal has run since the outage ended. The renewal
  cron runs every 6 hours (`0 */6 * * *`). If subscriptions expired during
  the outage, they will not be renewed automatically — they need to be
  **recreated**. Restart the service to trigger `ensureSubscriptionsForAllRooms()`.
- Monitor the Railway log for incoming webhook notifications over the next
  30 minutes to confirm live events are flowing again.

### After a Postgres backup restore

- Cross-check booking counts in Postgres against Exchange for the busiest
  room using the admin status page.
- Confirm audit log entries are intact (audit records are owned by Postgres
  and are not re-seeded by the resync).

### After adding a new room mailbox

- Verify the new room appears in the `/admin/status` subscription list.
- Create a test booking via the portal, cancel it, and confirm both actions
  appear correctly in Postgres and Exchange.
- See also: `room-mailbox-provisioning.md` for the full provisioning checklist.

### After a webhook subscription gap

- Confirm `removed` count in the resync log is not unexpectedly high. A large
  `removed` value during a subscription gap may indicate events were deleted
  in Exchange during the window; review Exchange audit logs if suspicious.
- If the subscription gap was longer than the Graph subscription lifetime
  (4,230 minutes, ~70 hours), any subscriptions that were not renewed in time
  will have been deleted by Graph. The startup `ensureSubscriptionsForAllRooms()`
  call recreates them, but confirm each room has a healthy subscription in
  `/admin/status` before standing down.

---

## Key source locations

| Symbol | File |
|---|---|
| `fullResync()` | `src/lib/graph/sync.ts` |
| `syncMailbox()` | `src/lib/graph/sync.ts` |
| `ensureSubscriptionsForAllRooms()` | `src/lib/graph/subscriptions.ts` |
| `renewExpiringSubscriptions()` | `src/lib/graph/subscriptions.ts` |
| `startCronJobs()` | `src/lib/cron.ts` |

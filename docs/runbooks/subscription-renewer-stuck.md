# Subscription renewer stuck

Graph subscriptions expire after ~3 days (4,230 minutes). When they expire,
Graph stops delivering webhook events and booking changes stop syncing.

---

## Symptoms

- Admin email: "Subscription renewal failures — 2 consecutive failing runs"
- `/admin/status` → Graph Subscriptions: count is 0, or "expiring within 24 hours"
- Bookings made via Exchange (Outlook) do not appear on room displays
- Audit log shows no `booking.create` entries from webhooks after a certain time
- Logs contain: `graph: failed to renew subscription`

---

## Diagnosis

**1. Check subscription health**

```
/admin/status → Graph Subscriptions section
```

Or query Postgres directly via Railway console:

```sql
SELECT id, "roomId", "expiresAt", "createdAt"
FROM "GraphSubscription"
ORDER BY "expiresAt" ASC;
```

**2. Check Graph connectivity**

```
/admin/status → Infrastructure → Microsoft Graph: Connected / Unreachable
```

If Graph shows Unreachable → this is a Graph API outage, not a renewer bug.
See `graph-throttling-spike.md`.

**3. Check application credentials**

Client secret expiry is the most common cause. Check in Azure Portal:
> App registrations → [MRBS app] → Certificates & secrets

If the secret is expired or close to expiry, rotate it. See `secret-rotation.md`.

**4. Check logs on Railway**

```
Railway dashboard → meetingrooms → Logs
```

Filter for: `subscription renewal` — look for the error message.

---

## Resolution

### Option A — Restart the service (fastest)

`ensureSubscriptionsForAllRooms()` runs on startup and creates missing
subscriptions.

```
Railway dashboard → meetingrooms → Settings → Restart
```

Wait ~60 s, then verify at `/admin/status`.

### Option B — Redeploy

Triggers a fresh build and startup sequence.

```
Railway dashboard → meetingrooms → Deployments → Redeploy latest
```

### Option C — If Graph is reachable but subscriptions are genuinely gone

After restarting (Option A), confirm all expected rooms have subscriptions:

```sql
SELECT r."displayName", gs.id, gs."expiresAt"
FROM "Room" r
LEFT JOIN "GraphSubscription" gs ON gs."roomId" = r.id
WHERE r.kind != 'COMPOSITE'
ORDER BY gs."expiresAt" ASC;
```

Rooms with `NULL` subscription id had no subscription created. This means
`ensureSubscriptionsForAllRooms()` failed for those rooms — check logs for
the specific error.

### After restoring subscriptions — catch up on missed events

Run a full resync to pull bookings that arrived while webhooks were down.
See `trigger-manual-resync.md`.

---

## Verification

1. `/admin/status` → Subscriptions: count matches number of bookable rooms (non-COMPOSITE, non-null mailbox)
2. Earliest expiry is > 24 hours from now
3. Logs show: `graph: subscription renewed` or `graph: subscription created`
4. Make a test booking → verify it appears in the booking list within 30 s

---

## Post-incident notes template

```
Date:
Duration of gap (subscriptions expired to restored):
Rooms affected:
Root cause:
Bookings missed (count from resync):
Action to prevent recurrence:
```

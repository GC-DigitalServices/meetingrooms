# Graph API throttling spike

Microsoft throttles Graph API requests per application per tenant.
When throttled, booking writes fail and the portal shows a degraded banner.
Reads continue from the Postgres cache.

---

## Symptoms

- Portal shows amber banner: "Booking service temporarily unavailable"
- Booking create/update/cancel returns 503 `GRAPH_UNAVAILABLE`
- Logs contain: `429` or `503` errors from graphClient, `markGraphDegraded`
- `/admin/status` → Microsoft Graph: Unreachable
- Subscription renewal logs show 429 responses

---

## Diagnosis

**1. Check Microsoft service health**

> https://admin.microsoft.com/AdminPortal/Home#/servicehealth

Filter by "Exchange Online" and "Microsoft Graph". A tenant-wide incident
here means nothing to do but wait.

**2. Check if it's just our app**

Look at Railway logs for the specific error:

```
Railway dashboard → meetingrooms → Logs
```

A `429 Too Many Requests` with `Retry-After` means the app is rate-limited.
A `503 Service Unavailable` with no Retry-After suggests a Graph outage.

**3. Confirm Redis degraded flag is set**

The app sets `graph:degraded` in Redis for 15 minutes on any Graph write failure.
After Graph recovers, the flag clears on the first successful write and the portal
banner disappears on the next page load.

```
Railway console → redis-cli GET graph:degraded
```

If `"1"` and Graph is healthy again → manually clear:

```
redis-cli DEL graph:degraded
```

---

## Resolution

### Throttling caused by a burst (e.g. mass resync during peak hours)

1. Wait for the throttle window to pass (typically 10–60 minutes)
2. The `graph:degraded` flag expires after 15 minutes regardless
3. Portal banner disappears on next page load after the flag clears
4. Pending bookings were NOT created — users will need to retry

### Throttling caused by subscription renewal running during peak load

The renewal cron runs every 6 hours. If this coincides with heavy booking
activity, consider adjusting the schedule in `src/lib/cron.ts`:

```ts
// Change from every 6h to a fixed off-peak time (e.g. 03:00 and 15:00)
cron.schedule("0 3,15 * * *", ...)
```

### Graph-side outage

Nothing to do. Wait for Microsoft to resolve. The 15-min Redis flag will
keep clearing and resetting while Graph is down. Reads continue from cache.
When Graph recovers:
1. Flag clears on the next successful booking write
2. Run a manual resync to catch up on any missed webhook events (see `trigger-manual-resync.md`)

---

## Throttle limits (approximate)

| Scope | Limit |
|---|---|
| Per app across tenant | 10,000 requests / 10 min |
| Calendar write operations | Lower — ~120/min per mailbox |
| Subscription operations | 1 create/room/15 min |

---

## Mitigation for future spikes

- Full resync runs at 02:00 — off-peak; do not move to daytime
- Subscription renewal every 6h — check it doesn't coincide with class change times
- Graph client has exponential back-off retry — most transient 429s are handled transparently

---

## Verification

1. Make a test booking → should succeed with 201
2. Portal amber banner should be gone (may require a page reload)
3. `/admin/status` → Microsoft Graph: Connected

---

## Post-incident notes template

```
Date:
Duration (first 429 to full recovery):
Root cause (our burst / tenant outage / coinciding cron):
Bookings that failed and needed retry:
Changes made to prevent recurrence:
```

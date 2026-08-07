# MRBS — IT Support & Troubleshooting Guide

Practical reference for IT staff supporting the Meeting Room Booking System (MRBS).
For step-by-step procedures, this guide points to the detailed runbooks in
`docs/runbooks/`. Start here to understand the system and diagnose issues; go to a
runbook to execute a fix.

> **Never put secrets in this file or the repo.** Credentials (client secret,
> session/QR keys, DB/Redis connection strings) live only in Railway → Variables.
> The IDs below (app registration, Entra group Object IDs, mailboxes, URLs) are
> identifiers, not secrets.

---

## 1. What the system is

A web portal + iPad room displays for booking meeting rooms, minibuses, and visitor
car-park bays at Greenhead College.

- **Stack:** Next.js 15 (App Router, React 19, TypeScript), Prisma + PostgreSQL,
  Redis, Socket.IO, hosted on **Railway**.
- **Auth:** Microsoft Entra ID (Azure AD) via MSAL.
- **Calendaring:** Microsoft Graph / Exchange Online.

### The one architectural rule that explains everything
**Exchange is the source of truth; Postgres is a cache.** Every booking is written
to the room's Exchange mailbox calendar via Graph *first*, then mirrored into
Postgres. The portal is the **only** writer to room mailboxes (mailboxes are locked
down so users can't book them directly from Outlook). Consequences:

- If Postgres and Exchange disagree, Exchange wins — reconcile with a resync.
- The Graph event's **organizer is the room mailbox, not the person**. The real
  booker is stored separately (`Booking.organiserUpn` + an extended property).
  Never identify the booker from the Graph organizer field.

---

## 2. Where it runs (Railway)

- **App, PostgreSQL, and Redis** are all Railway-managed services in one project.
- **Canonical URL:** whatever `PUBLIC_BASE_URL` is set to in Railway → Variables
  (a Greenhead custom domain). Always check Railway for the live value rather than
  trusting a URL written down elsewhere — a wrong `PUBLIC_BASE_URL` silently breaks
  sign-in redirects, Graph webhooks, and QR links.
- **Deploy:** pushing to the `main` branch on GitHub triggers a Railway deploy.
  - Build: `pnpm prisma generate && pnpm build`
  - Start: `pnpm prisma migrate deploy && pnpm start` (so **DB migrations run
    automatically on every deploy**)
  - Health check: `GET /api/health`
- **Config that lives in the repo (applied on deploy):** `config/groups.yaml`
  (groups, admin, notification emails). Railway's filesystem is ephemeral, so these
  files can't be edited in production — change them in git and redeploy.
- **Rooms are NOT in a file** — they're in Postgres, managed via **Admin → Rooms**.
  `config/rooms.yaml` is seed/reference only.

Rollback and deploy details: `docs/runbooks/rolling-deploy-and-rollback.md`.

---

## 3. Configuration reference

### Environment variables (Railway → Variables)
| Variable | Purpose |
|---|---|
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Entra app registration credentials |
| `DATABASE_URL` | Postgres (Railway-injected) |
| `REDIS_URL` | Redis (Railway-injected; internal URL) |
| `SESSION_SECRET`, `QR_SIGNING_KEY` | Signing keys (≥32 chars) |
| `PUBLIC_BASE_URL` | Canonical public URL — redirects, webhooks, QR links |
| `MAIL_SENDER_UPN` | Mailbox that sends notification emails (`noreply@greenhead.ac.uk`) |
| `SYNC_WINDOW_DAYS` | How far ahead the nightly resync pulls events (default 180) |
| `PORT` | Defaults to 3000 |

Missing/invalid required vars make the app **fail loudly on boot** — check Railway
deploy logs for "Invalid environment configuration".

### `config/groups.yaml`
- `staff_groups` — Entra group(s) whose members are treated as **staff**.
- `admin_group` — Entra group whose members are **portal admins** (see §5).
- `premises_email` — receives premises/transport notifications.
- `minibus_email` — additionally copied on **minibus** notifications.
- `admin_alert_email` — receives system alerts (offline displays, cron failures).

---

## 4. Identity & Entra reference

| Thing | Value |
|---|---|
| App registration (client) ID | `655e8d1f-b446-4124-978e-a74e2d57183c` |
| "All Staff" group | `be1c4aa6-38e4-4232-bd61-955e63121fb1` |
| **MRBS Admin** group (current `admin_group`) | `ff0b0ad7-2321-4307-ba75-14df09069623` |
| GC IT Support group (was `admin_group` until 2026-08-06) | `6f0bf91a-5b22-4a64-9874-6754d2f0e18e` |

**Graph API permissions on the app registration** (all app-only unless noted):
- `Calendars.ReadWrite` (application) — booking read/write to room mailboxes.
- `Mail.Send` (application) — sending notification emails as `MAIL_SENDER_UPN`.
  **Must have admin consent.** (Added 2026-08-06 — see §7.)
- `Group.Read.All` (delegated) + `User.Read` (delegated) — used **only** at sign-in
  to read the user's profile and group membership. No user tokens are stored.

Tip: search Entra groups by **Object ID**, not display name — display names don't
always match what you expect (the admin group was for a long time the GC IT Support
group, mislabelled "MRBS Admin" in config comments).

---

## 5. Access & permissions

Roles are derived **at sign-in** from Entra group membership and cached on the user's
Postgres record:
- **Admin** = member of the `admin_group` (MRBS Admin group).
- **Staff** = member of a `staff_groups` group (sees full booking detail).
- **Student** = everyone else (limited visibility; sees others' bookings as "Busy").
- **Room booking rights** = a room's `allowedGroups` (empty = everyone). Set per room
  in Admin → Rooms.

### Granting portal admin
1. In **Entra → Groups**, open the **MRBS Admin** group by Object ID:
   `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Members/groupId/ff0b0ad7-2321-4307-ba75-14df09069623`
2. **Add members →** the person.
3. They **sign out and back in** — roles are only recomputed at sign-in.

**Key gotcha:** role changes (grant *or* revoke, staff or admin, or room
`allowedGroups`) **do not take effect until the user next signs in**. Their cached
role can persist for the life of their session. There is no in-portal user-role
management — it's all Entra groups. Do **not** edit `User.isAdmin` in Postgres
directly; it's overwritten from group membership on next sign-in.

---

## 6. Bookings failing / "Booking service temporarily unavailable"

When any Graph write fails, the app sets a Redis key `graph:degraded` (15-minute TTL)
that **fast-fails all booking attempts** until it clears. This protects against a
flapping Graph, but a single transient error will block bookings for 15 minutes.

**Diagnose:** check Railway logs for `graph_api_error` / `markGraphDegraded`, and
**Admin → System status**.

**Clear it manually after fixing the underlying cause:**
```
redis-cli -u "<REDIS_URL>" DEL graph:degraded
```
Use the full `REDIS_URL` (with embedded auth) from Railway → Variables.

Common underlying causes: Graph throttling (`docs/runbooks/graph-throttling-spike.md`),
an Exchange permission/policy issue (§7/§8), or a bad room mailbox.

---

## 7. Notification emails not arriving

Premises, minibus, and car-park confirmation emails all send **as `MAIL_SENDER_UPN`
(`noreply@greenhead.ac.uk`)** via Graph `sendMail`. Bookings themselves are
unaffected by mail failures (mail is best-effort).

**Where to look:** **Admin → Audit log** shows `Premises email failed` rows with the
underlying error; Railway logs show `mailer: *_failed`.

- `403 ErrorAccessDenied` (no `[RAOP]`) → the app lacks the **`Mail.Send`**
  application permission (or admin consent). This is separate from calendar
  permissions, so bookings can work while email 403s.
- `403 ... [RAOP]` → an Exchange Application Access Policy is scoping the app away
  from the sender mailbox (see §8).
- Full procedure: **`docs/runbooks/mail-send-permission.md`**.

The minibus checklist is attached only if one has been uploaded at
**Admin → Minibus checklist**.

---

## 8. Room / minibus / bay mailbox issues

- Room mailboxes must stay **locked down** (`AllBookInPolicy=$false`, empty
  `BookInPolicy`) so the portal is the only writer. Verify with
  `docs/runbooks/mailbox-lockdown-verification.md`.
- **Provisioning a new mailbox:** `docs/runbooks/room-mailbox-provisioning.md`.
- **`403 ... [RAOP]`** on a specific mailbox means an Exchange **Application Access
  Policy** is blocking the app from it. Historically the app was scoped to a "Room
  Mailboxes" distribution group; that policy was removed on 2026-07-02, but if it's
  ever recreated, any new mailbox must be added to the allowed group. Diagnose:
  ```powershell
  Test-ApplicationAccessPolicy -Identity "<mailbox>" -AppId "655e8d1f-b446-4124-978e-a74e2d57183c"
  Get-ApplicationAccessPolicy
  ```
  Policy changes take up to ~60 minutes to take effect at the API.

---

## 9. Real-time updates / sync

- **Live updates** use Socket.IO in-process (single instance, no Redis pub/sub).
  Portal grids and iPad displays subscribe to room channels.
- **External changes** (someone edits an event directly in Exchange) arrive via Graph
  **webhook subscriptions**, deduplicated by `iCalUId`.
- **Nightly full resync** (02:00) reconciles Postgres against Exchange within
  `SYNC_WINDOW_DAYS`. Trigger manually: `docs/runbooks/trigger-manual-resync.md`.

**Symptoms & fixes:**
- *"Room shows free but is actually booked" / stale data* → a subscription likely
  lapsed. Check **Admin → System status** (amber banner if subscriptions expire soon)
  and use **Renew now**; deeper issues: `docs/runbooks/subscription-renewer-stuck.md`.
  Then run a manual resync.
- *Live updates stopped after a while* → subscription expiry, or a client that lost
  the socket and didn't re-subscribe (known limitation, §12) — a page reload fixes
  the client side.

---

## 10. iPad displays

- iPads authenticate with a **device token** (issued once during pairing in
  **Admin → Devices**), never with a user login, and never talk to Graph directly.
- The QR code on a display is short-lived (5-minute HMAC) and is provenance, not
  auth.
- Display won't come online / shows offline: `docs/runbooks/ipad-wont-come-online.md`.
- Re-pair or revoke a device in **Admin → Devices**.

---

## 11. Diagnostics toolkit

- **Admin → System status** — infrastructure and display health, subscription expiry,
  "Renew now".
- **Admin → Audit log** — every booking action, plus failure rows (e.g.
  `Premises email failed`) with the underlying error in the detail column.
- **Admin → Bookings** — search and delete any booking (rooms, minibus, car park).
- **`GET /api/health`** — liveness/health endpoint (used by Railway).
- **Railway → Deployments → Logs** — structured (pino) logs; search for
  `graph_api_error`, `mailer:`, `lock:`, `redis:`.
- **PostgreSQL** — use `DATABASE_PUBLIC_URL` from Railway for external access; the
  `User` table's `isAdmin`/`isStaff` show cached roles, `Booking` mirrors Exchange.

---

## 12. Known behaviours (as of 2026-08-07)

These are intended behaviours — don't burn time re-diagnosing them:

- **Role changes need a re-login** to take effect (roles are cached at sign-in).
- **Bookings are limited to 07:00–21:00** (Europe/London), enforced server-side —
  a rejected out-of-hours booking is expected, not a fault. Minibuses are exempt
  (multi-day/overnight hires).
- **Minibus** bookers get an email confirmation, **not** an Outlook calendar entry
  (by design, like car-park bookings).

_Fixed in the 2026-08-07 hardening pass (previously listed here): the 5s booking-lock
double-booking window, recurring-booking DST drift, and portal live-views not
re-subscribing after a socket reconnect._

---

## 13. Runbook index (`docs/runbooks/`)

| Runbook | When |
|---|---|
| `rolling-deploy-and-rollback.md` | Deploying / rolling back |
| `restore-postgres.md` | Database restore |
| `secret-rotation.md` | Rotating credentials/keys |
| `mail-send-permission.md` | Notification emails 403 / not sending |
| `mailbox-lockdown-verification.md` | Verify rooms can't be booked outside the portal |
| `room-mailbox-provisioning.md` | Add a new room/minibus/bay mailbox |
| `graph-throttling-spike.md` | Graph 429s / throttling |
| `subscription-renewer-stuck.md` | Webhook subscriptions not renewing |
| `trigger-manual-resync.md` | Force an Exchange→Postgres reconcile |
| `ipad-wont-come-online.md` | iPad display offline |

Setup references: `docs/ipad-setup.md`, `docs/threat-model.md`,
`docs/performance-budget.md`.

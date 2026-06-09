# PostgreSQL restore runbook

**When to use this runbook:**

- Data corruption in the Postgres cache (e.g. bad migration, accidental DELETE/TRUNCATE).
- Railway Postgres instance becomes unavailable and cannot self-recover.
- You need to roll back to a known-good state after a failed deployment.

**Do not use for Exchange data loss.** Bookings are sourced from Exchange — if
Exchange data is intact you can always do a full rebuild (Section 4). A restore
is only necessary when you need to recover Postgres-owned data (Rooms, Devices,
Users, AuditLog, GraphSubscription) or when a rebuild would be too slow.

---

## 1. Understand what Postgres owns

| Table | Source of truth | Recoverable without backup? |
|---|---|---|
| `Booking` | Exchange (cache) | Yes — via `fullResync()` |
| `Room` | `config/rooms.yaml` (cache) | Yes — via `pnpm rooms:import` |
| `GraphSubscription` | Graph API (cache) | Yes — via `ensureSubscriptionsForAllRooms()` |
| `User` | Entra / MSAL (cache) | Yes — repopulates on first login |
| `Device` | **Postgres owns this** | No — all devices must be re-paired |
| `AuditLog` | **Postgres owns this** | No — permanently lost if no backup |

---

## 2. Railway backup restore

Railway takes daily automatic backups with point-in-time recovery. This is the
primary recovery path.

### 2a. Restore the database

1. Open the Railway dashboard.
2. Navigate to your project → the Postgres service → **Backups** tab.
3. Select the most recent backup before the incident. Railway shows a timestamp
   per backup — choose the one that predates the corruption or failure.
4. Click **Restore**. Railway creates a **new** database instance; the existing
   one is left untouched. Note the new database's connection string.

### 2b. Update the app's DATABASE_URL

1. In the Railway dashboard go to your application service → **Variables**.
2. Update `DATABASE_URL` to the connection string of the restored database.
3. Redeploy the application service (or trigger a restart) so it picks up the
   new variable.

Verify the application can connect: check the deployment logs for a successful
Prisma connection. You should see no connection errors at startup.

### 2c. Post-restore checklist

Run these steps in order from inside the Railway shell or locally with
`DATABASE_URL` pointing at the restored instance.

```bash
# 1. Ensure all migrations are applied.
#    Safe to run against an already-migrated DB — it is a no-op if current.
pnpm prisma migrate deploy

# 2. Verify the app starts and serves the portal without errors.
#    Check Railway deployment logs for any Prisma/DB errors.
```

Then in the running application (or via a one-off Railway run command):

```bash
# 3. Recreate any Graph subscriptions that expired or were lost.
#    ensureSubscriptionsForAllRooms() skips rooms that already have a live subscription.
#    The app calls this on startup automatically, so a redeploy is sufficient.
#    If you want to force it immediately without a redeploy, call it via the
#    admin API or a one-off script once the app is running.

# 4. Trigger a full resync to bring bookings up to date with Exchange.
#    The app will be slightly stale from the restore point until this completes.
#    fullResync() is also called on startup; a redeploy is sufficient.
```

**After a successful restore the following are back to normal automatically:**

- All bookings (Exchange cache) — refreshed on startup via `fullResync()`.
- Graph subscriptions — recreated on startup via `ensureSubscriptionsForAllRooms()`.
- Redis cache — reconstructs from DB and Graph on restart; no action needed.

**After a successful restore verify manually:**

- [ ] Portal loads and shows current bookings.
- [ ] An iPad display shows the correct room status.
- [ ] Admin user list in the portal loads without errors.
- [ ] AuditLog entries exist up to the backup timestamp (entries after that
      timestamp are gone — this is expected and should be noted in an incident
      log).
- [ ] Device records are intact (check Settings → Devices in the portal). If
      any devices are missing, those iPads must be re-paired (see Section 4c).

---

## 3. Decommission the old database instance

Once you are confident the restore is healthy:

1. In Railway, delete the old (corrupted/failed) Postgres instance.
2. Update any monitoring or alerting that references the old connection string.

Do not delete the old instance until you have confirmed the restored instance is
fully operational.

---

## 4. Full rebuild (no backup available)

Use this path only when no backup can be restored. It reconstructs all
recoverable data from Exchange and config files. Expect 15–30 minutes of
reduced service depending on the number of rooms.

**Before starting:** provision a fresh Postgres instance on Railway and set
`DATABASE_URL` in the app's environment variables.

### 4a. Apply schema

```bash
pnpm prisma migrate deploy
```

This creates all tables on the empty database. The app cannot start until this
completes.

### 4b. Import rooms

```bash
pnpm rooms:import
```

Reads `config/rooms.yaml` and upserts all rooms (STANDARD, COMPOSITE, SECTION).
Safe to re-run — uses upsert, will not duplicate rows.

Verify: the Room table should have the expected number of rows.

```bash
pnpm prisma studio
# or: connect with psql and run: SELECT kind, count(*) FROM "Room" GROUP BY kind;
```

### 4c. Re-pair all devices

The `Device` table stores `tokenHash` values that are the device credentials.
These are not stored anywhere else. Every enrolled iPad must be re-paired.

1. In the portal (once it is running), go to Settings → Devices.
2. Delete all existing device records, or truncate the `Device` table directly:

   ```sql
   TRUNCATE "Device";
   ```

3. For each iPad: open the display URL on the device. It will prompt for a
   pairing code. Follow the normal enrolment flow.

**Do not skip this step.** Old `tokenHash` values in a partially-restored DB
would either accept stale tokens (security risk) or reject all requests (service
outage).

### 4d. Recreate Graph subscriptions

The app calls `ensureSubscriptionsForAllRooms()` on startup. Once the Room table
is populated (step 4b) and the app has started, it will automatically create
subscriptions for every bookable room with a mailbox.

If you need to trigger this without a full restart:

```ts
// In a one-off script or Railway shell:
import { ensureSubscriptionsForAllRooms } from "@/lib/graph/subscriptions";
await ensureSubscriptionsForAllRooms();
```

Verify: the `GraphSubscription` table should have one row per bookable
non-COMPOSITE room.

### 4e. Full resync from Exchange

The app calls `fullResync()` on startup. This pulls all events from every room
mailbox over the next 60 days into the `Booking` table.

If you need to trigger this without a full restart:

```ts
// In a one-off script or Railway shell:
import { fullResync } from "@/lib/graph/sync";
await fullResync();
```

Resync pulls a 60-day forward window from the current time. Past bookings (before
now) are not in the cache and will not appear — this is by design.

Monitor progress in the application logs. On completion you will see:

```
graph: resync_completed { rooms: N, added: N, updated: N, removed: N, errors: 0 }
```

A non-zero `errors` count means one or more mailboxes could not be reached.
Check each failed `roomId` against Exchange and investigate Graph access for
that mailbox.

---

## 5. What is NOT recoverable

| Data | Why | Mitigation |
|---|---|---|
| **AuditLog entries** | Postgres-owned; not mirrored anywhere else | Use Railway backups; accept loss of entries between last backup and incident |
| **Device token hashes** | Postgres-owned; the raw token is never stored | Re-pair all devices after a full rebuild (Section 4c) |
| **Bookings before "now"** | `fullResync()` only covers a 60-day forward window | Historical bookings are only recoverable from a backup |
| **User login history** (`lastLoginAt`) | Postgres cache; not in Exchange or Entra | Repopulates naturally as users log in |

---

## 6. Testing requirement

**This procedure must be tested at least once in the dev/staging environment
before go-live.** Specifically:

- [ ] Perform a Railway backup restore against a dev Postgres instance.
- [ ] Confirm `pnpm prisma migrate deploy` completes cleanly against the
      restored instance.
- [ ] Confirm bookings appear correctly after startup (fullResync).
- [ ] Confirm an iPad display enrols successfully after a device table wipe.
- [ ] Confirm the AuditLog loss is understood and acceptable to the stakeholders.

Record the test date and outcome in the incident log or a comment in this file.

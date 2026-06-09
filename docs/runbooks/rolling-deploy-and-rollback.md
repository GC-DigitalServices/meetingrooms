# Rolling deploy and rollback

---

## Normal deploy

Every push to `main` triggers an automatic Railway deployment:

1. Railway clones the repo and runs nixpacks
2. Build: `pnpm prisma generate && pnpm build`
3. Start: `pnpm prisma migrate deploy && pnpm start`

Railway starts the new instance before terminating the old one. There is a
brief overlap (~30 s) where both serve traffic. In-process cron jobs restart
with the new instance.

**Monitoring a deploy:**
- Railway dashboard → meetingrooms → Deployments (live build log)
- `/api/health` — returns 200 once the new instance is accepting requests

---

## Rollback decision tree

```
Did the deploy break something?
  │
  ├─ Was a database migration included?
  │     ├─ No  → Option A (instant Railway rollback)
  │     └─ Yes → Was it destructive (DROP COLUMN, column rename)?
  │                   ├─ No  → Option A (Railway rollback + migration state note)
  │                   └─ Yes → Option B (database restore required — see restore-postgres.md)
  │
  └─ Is it a code-only bug (no schema change)?
        └─ Option A
```

---

## Option A — Railway rollback (fastest, no schema change)

1. Railway dashboard → meetingrooms → **Deployments**
2. Find the last known-good deployment
3. Click **Redeploy** on that deployment

The old build image is reused — no rebuild, ~30 s to active.

> ⚠ This does NOT reverse database migrations. If the rollback code expects a
> column that the forward migration added, the app will error on the missing column.
> In practice, additive migrations (new columns with defaults, new tables) are
> safe to roll back to. Only destructive migrations cause problems.

**After rollback:**
- Verify `/api/health` and spot-check booking create/cancel
- Create a `git revert` commit to track the rollback in the repo:
  ```bash
  git revert HEAD  # or the specific bad commit hash
  git push
  ```

---

## Option B — Rollback with database restore

Required when a destructive migration (DROP COLUMN, table truncation) was
deployed and the code rollback needs columns that no longer exist.

See `restore-postgres.md` for the full procedure.

Brief summary:
1. Railway rollback the app code (Option A above) — this stops further damage
2. Restore Postgres from backup in Railway dashboard
3. Point `DATABASE_URL` to the restored instance
4. Redeploy the rolled-back code

---

## Safe migration patterns

Before merging a schema change, verify it is additive and non-blocking:

| Safe | Risky — coordinate with DBA |
|---|---|
| Add nullable column | Add NOT NULL column without default (locks table) |
| Add new table | DROP COLUMN (instant data loss) |
| Add index CONCURRENTLY | Rename column (breaks existing code) |
| Add column with DEFAULT | Change column type |

For large tables (Booking, AuditLog), use `CREATE INDEX CONCURRENTLY` in raw SQL — Prisma's `@@index` annotation creates it blocking by default.

---

## Verification after any rollback

- [ ] `/api/health` returns `{"ok":true,...}` for Postgres, Redis, and Graph
- [ ] `/admin/status` shows all subscriptions active, all devices online
- [ ] Sign in to portal — session works
- [ ] Create a test booking, cancel it — no errors
- [ ] Room display shows the test booking, then its cancellation
- [ ] Check Railway logs for any new errors

---

## Post-incident notes template

```
Date:
Bad deployment hash:
Good deployment hash (rolled back to):
Migration included: yes/no
Migration destructive: yes/no (if yes, describe)
Database restored: yes/no
Duration of degraded service:
Root cause:
Prevention:
```

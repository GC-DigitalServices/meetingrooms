# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Working rules. `build.md` is the source of truth — if it conflicts with this file, `build.md` wins and update this file.

## Commands

pnpm only (`packageManager: pnpm@9.15.4`, Node >= 22).

```bash
docker compose up -d          # local Postgres + Redis (healthchecks configured)
pnpm prisma generate          # required after any schema.prisma change
pnpm prisma migrate dev       # local schema change -> new migration
pnpm dev                      # tsx server.ts — NOT `next dev` (see below)
pnpm build && pnpm start      # production

pnpm typecheck                # tsc --noEmit
pnpm lint                     # next lint
pnpm test                     # vitest run
pnpm test:watch
pnpm test:e2e                 # playwright, ./e2e, needs a server on PLAYWRIGHT_BASE_URL

pnpm smoke <room-upn>         # Graph app-creds + Application Access Policy check
pnpm rooms:import             # seed rooms from config/rooms.yaml
pnpm ws:harness               # Socket.IO connectivity harness
```

Single test / single case:

```bash
pnpm vitest run src/lib/booking/horizon.test.ts
pnpm vitest run -t "rejects beyond horizon"
pnpm playwright test e2e/accessibility.spec.ts
```

```bash
pnpm diag:room <room-upn> <YYYY-MM-DD>   # Exchange vs cache, side by side, for one room-day
```

CI (`.github/workflows/ci.yml`) runs `pnpm audit --audit-level=high`, gitleaks, `prisma generate`, typecheck, lint, test. Match it locally before pushing. Health check: `GET /api/health`.

**Deployment is push-to-`main`.** Railway watches `main` only — a feature branch push deploys nothing. `railway.toml` builds `pnpm prisma generate && pnpm build`, then starts `pnpm prisma migrate deploy && pnpm start`, so **migrations run at container start, not build**: a bad migration fails the `/api/health` check rather than the build, and Railway retries 3 times before giving up.

**`pnpm dev` runs a custom server, not `next dev`.** `server.ts` boots Next programmatically and attaches Socket.IO to the same HTTP server (invariant 5). Anything touching WebSockets must be exercised through `pnpm dev`. `src/instrumentation.ts` starts `src/lib/cron.ts` in the same process — subscription renewal (6h), full resync (02:00), device heartbeat check (15min) — so cron runs in dev too.

## Invariants — break these and the design unravels

1. **Exchange is the source of truth; Postgres is a cache.** Every mutation goes through Graph first, then Postgres. Never write to Postgres without a Graph call. (Exceptions — original data we own: rooms, devices, users, audit, sessions, managed files.)

2. **Our app is the only writer to room mailboxes — except Salamander.** `AllBookInPolicy = $false` + empty `BookInPolicy` stops any *user* booking a room outside the portal. It does not stop an app writing with its own credentials, and the Salamander MIS does exactly that: it publishes the whole academic year of timetable straight into the room mailboxes. Its output is not uniform and must not be assumed well-formed: as well as recurring series, it has published a term of a weekly lesson as **one continuous event** (14 Sep 12:35 → 14 Dec 13:35), which Exchange holds as the room being busy every hour of every day in between. Consequences: (a) the Graph `organizer` is the room mailbox, not the human — the real organiser lives in `Booking.organiserUpn`, the `OrganiserUpn` extended property, the subject prefix, and the attendee list, so **never** read Graph `organizer` to identify who booked; (b) our cache is only as complete as what we mirror from Exchange, which is what couples `SYNC_WINDOW_DAYS` to the booking horizon (see 6 below); (c) Salamander can double-book on top of a portal booking — Exchange accepts overlapping direct writes — and nothing currently detects or reports that.

   Telling its events from ours: our writes carry a `Source` extended property, read back by `resolveBookingSource` into `Booking.source`. No property means `EXCHANGE` — written straight to the mailbox by something else. `SELECT * FROM "Booking" WHERE source = 'EXCHANGE'` is the inventory of what we did not write. `reportIfOverlong` additionally warns (`graph: overlong_room_booking`) on any non-MINIBUS booking over the 8h write-path cap, which is how the term-long blocks surface.

   **Report, never filter.** Bad Salamander data still mirrors: the room really is blocked in Exchange, so the conflict check must keep seeing it. Dropping or shortening such a row hands out bookings Exchange then rejects — an invisible booking fault traded for a visible display one. Fix it at source (delete the events, have Salamander republish); a webhook `deleted` clears the cache immediately.

3. **All Graph calls use application credentials.** The delegated token is used exactly twice at sign-in (`/me`, `/me/transitiveMemberOf`) then discarded. No refresh tokens stored.

4. **The QR token is provenance, not auth.** 5-min HMAC, lets us tag `source = IPAD_QR` and reject photographed QRs. MSAL is what authorises writes.

5. **One instance.** Socket.IO in-process, no Redis pub/sub. Don't pre-build for multi-instance.

6. **`SYNC_WINDOW_DAYS` >= the admin room horizon.** Currently 370 vs 365 (`src/lib/booking/horizon.ts`). The conflict check reads the cache, and the cache only mirrors Salamander's timetable as far out as the sync window — book a room beyond it and the check is blind. Minibus and visitor parking are exempt (360 days) because nothing outside this app writes to those mailboxes. Raise one without the other and rooms can be silently double-booked.

## Booking write path — the only safe order

`src/lib/booking/service.ts` — `createBooking`, `updateBooking`, `cancelBooking`, `createRecurringBookings`, `cancelRemainingRecurring`.

1. `canUserBookRoom(user, room)` — admin bypass is audited with `adminOverride: true`.
2. Acquire Redis lock. Key: `lock:room:<familyRootId>` — for a SECTION that's `parentRoomId`; for STANDARD/COMPOSITE it's the room's own id. Always lock the family root.
3. Conflict check against cache (the lock makes it reliable against *our* concurrent writes; against Salamander it is only as good as what the webhook and nightly resync have mirrored).
4. Graph write (one event with all section mailboxes as resources for composite bookings — not N events, no verification poll).
5. Postgres mirror.
6. Socket.IO broadcast — section events publish to **both** `room:<sectionId>` and `room:<parentCompositeId>`.
7. Audit.
8. Release.

Graph failure after lock acquired: release, surface error, no DB write, no broadcast. `isGraphDegraded()` is checked *before* the lock so a known-bad Graph fails fast without holding it.

Errors in `src/lib/booking/errors.ts` map to API status codes: `NotPermittedError` 403, `ConflictError` 409, `NotOrganiserError`, `OutOfHoursError`, `BeyondHorizonError` 400 `BEYOND_HORIZON`, `RoomNotBookableError`, `LockTimeoutError`, `GraphUnavailableError`.

## Room kinds — the per-kind divergences

`RoomKind`: STANDARD, COMPOSITE, SECTION, MINIBUS, PARKING. Most special-casing lives in `createBooking`; check it before assuming uniform behaviour.

- **PARKING is a pool, not a room.** A busy bay must not block the pool, so the family conflict check is skipped: inside the lock we pick any free section (bay), write the event to that bay's mailbox with *no* resource attendees, and record the booking against the bay id — not the pool id.
- **MINIBUS** has no duration cap (multi-day bookings are legitimate) and requires `premisesNotes`.
- Parking is excluded from the room grid; both minibus and parking have their own portal pages (`/minibus`, `/carpark`).

## Booking horizon

`src/lib/booking/horizon.ts` is the single source of truth. Enforced server-side in `createBooking`/`updateBooking` (`BeyondHorizonError` -> 400 `BEYOND_HORIZON`) and mirrored by the date pickers and date navigation — the `max` attribute is a hint, never the limit.

```
everyone      60 days, every room kind
admin         365 days on rooms (must stay <= sync window, invariant 6)
admin         360 days on MINIBUS and PARKING
```

`createRecurringBookings` validates the *last* occurrence up front so a too-long series is rejected whole rather than part-created. Horizon maths is calendar-day, not `+N*24h` — the latter drifts across DST.

## Permissions

```ts
canUserBookRoom(user, room):
  user.isAdmin                            -> true
  room.allowedGroups.length === 0         -> true
  else groupIds intersects allowedGroups
```

Composite (whole room): user must satisfy every section's `allowedGroups` **and** the composite's own. Fail -> `NotPermittedError` -> 403.

## Visibility — always server-side in `src/lib/booking/visibility.ts`

- **Room list:** staff see all; students see only bookable rooms by default, with a "show all" toggle that reveals others as free/busy only.
- **Booking detail on someone else's booking:**
  - Own bookings: full detail.
  - Student-organised: "Busy" to everyone except admins.
  - Staff-organised: full to staff, "Busy" to students.

Never trust the client to filter. Strip before serialisation.

## Composite rooms — the gotchas

- COMPOSITE has `mailboxUpn = null`; sections each have their own.
- Webhook dedup key is `iCalUId` (one composite booking arrives N times).
- No subscription on the composite itself.
- A SECTION-scoped iPad never offers whole-room bookings, even if all sections are free.

## Project layout

Everything ships under `src/`, alias `@/` -> `./src`.

```
src/app/(portal)/      MSAL-auth web portal (incl. /admin, /minibus, /carpark, /r/[id] QR landing)
src/app/(display)/     device-token iPad UI
src/app/api/           auth, bookings, rooms, availability, devices, admin, qr, webhooks/graph, health
src/lib/graph/         Graph client + events + subscriptions + sync (app creds only)
src/lib/auth/          MSAL, sessions, device tokens, group resolution
src/lib/booking/       pure logic: conflicts, permissions, visibility, horizon, hours, duration
                       + service.ts (the write path — the one impure file here)
src/lib/realtime/      Socket.IO, Redis lock, publish, rate limit
src/lib/db/            Prisma client, audit, managed files
src/lib/config/        zod env + YAML loaders
src/lib/mailer/        outbound notifications via Graph Mail.Send
src/lib/cron.ts        node-cron jobs, started by src/instrumentation.ts
server.ts              custom HTTP server: Next + Socket.IO
config/rooms.yaml      seed/reference only — rooms now managed via Admin UI -> Postgres
config/groups.yaml     staff_groups, admin_group
prisma/schema.prisma   Room, Booking, Device, User, GraphSubscription, AuditLog, ManagedFile
docs/runbooks/         operational procedures (mailbox provisioning, resync, rollback, ...)
Phases/                phase-by-phase build plan
```

`(portal)` and `(display)` never import each other. Shared code -> `src/lib/` or `src/components/shared/`.

## Config

`src/lib/config/index.ts` — a zod-validated singleton that throws on first access if anything is missing, so misconfigured deploys fail loudly at boot. Required: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (>=32), `QR_SIGNING_KEY` (>=32), `PUBLIC_BASE_URL`. Optional: `MAIL_SENDER_UPN`, `SYNC_WINDOW_DAYS` (default 370 — see invariant 6), `PORT`.

## Conventions

- **UI:** portal uses shadcn/ui. Display uses bespoke full-screen; min 32pt body, 64pt status, >=56pt targets; portrait 1024x1366 only.
- **Status colours:** `--status-free`, `--status-busy`, `--status-soon` in `globals.css`. Never hard-code.
- **Dates:** UTC everywhere, render in `Europe/London`, conversions via `date-fns-tz`.
- **Composite displays:** 2-4 section cards + one shared QR.

## Testing

- Vitest unit tests for `src/lib/booking/` pure functions. Tests live beside their source as `*.test.ts`; `vitest.config.ts` only picks up `src/**/*.test.ts(x)`, node environment.
- Graph wrappers use a recorded-response fake in `src/lib/graph/__mocks__/` — run offline.
- Playwright happy paths against the M365 Dev tenant. Never against production.

## Don't

- Migrate irreversibly.
- Call Graph from client components.
- Store Microsoft user tokens.
- Add polling as a WebSocket fallback — fix the socket.
- Let the iPad hit Graph directly.
- Treat the QR token as auth.
- Read Graph `organizer` to identify the booker.
- Introduce a second source of truth (draft bookings not in Exchange).
- Trust the client to filter visibility.
- Pre-build for multi-instance.

## How to work

**Think first.** State assumptions. Surface tradeoffs. If multiple interpretations exist, present them — don't pick silently. If something's unclear, stop and ask.

**Minimum code.** Nothing speculative. No abstractions for single-use code. No "flexibility" that wasn't requested. No error handling for impossible scenarios. If 200 lines could be 50, rewrite.

**Surgical changes.** Touch only what the request demands. Don't "improve" adjacent code or refactor things that aren't broken. Match existing style. Remove imports/symbols *your* changes orphaned; flag pre-existing dead code rather than deleting it.

**Verifiable goals.** Reframe vague tasks into checks:

- "Add validation" -> write failing tests for invalid inputs, then pass them.
- "Fix the bug" -> write a reproducing test, then pass it.
- "Refactor X" -> tests pass before and after.

For multi-step work, state the plan with a verify-step on each line before starting.

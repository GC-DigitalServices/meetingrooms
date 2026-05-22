\# claude.md



Working rules. `build.md` is the source of truth — if it conflicts with this file, `build.md` wins and update this file.



\## Invariants — break these and the design unravels



1\. \*\*Exchange is the source of truth; Postgres is a cache.\*\* Every mutation goes through Graph first, then Postgres. Never write to Postgres without a Graph call. (Exceptions — original data we own: rooms, devices, users, audit, sessions.)



2\. \*\*Our app is the only writer to room mailboxes.\*\* Enforced by `AllBookInPolicy = $false` + empty `BookInPolicy` on each mailbox. Consequence: the Graph `organizer` is the room mailbox, not the human. The real organiser lives in `Booking.organiserUpn`, the `OrganiserUpn` extended property, the subject prefix, and the attendee list. \*\*Never\*\* read Graph `organizer` to identify who booked.



3\. \*\*All Graph calls use application credentials.\*\* The delegated token is used exactly twice at sign-in (`/me`, `/me/transitiveMemberOf`) then discarded. No refresh tokens stored.



4\. \*\*The QR token is provenance, not auth.\*\* 5-min HMAC, lets us tag `source = IPAD\_QR` and reject photographed QRs. MSAL is what authorises writes.



5\. \*\*One instance.\*\* Socket.IO in-process, no Redis pub/sub. Don't pre-build for multi-instance.



\## Booking write path — the only safe order



1\. `canUserBookRoom(user, room)` — admin bypass is audited with `adminOverride: true`.

2\. Acquire Redis lock. Key: `lock:room:<familyRootId>` — for a SECTION that's `parentRoomId`; for STANDARD/COMPOSITE it's the room's own id. Always lock the family root.

3\. Conflict check against cache (reliable inside the lock, because we're the only writer).

4\. Graph write (one event with all section mailboxes as resources for composite bookings — not N events, no verification poll).

5\. Postgres mirror.

6\. Socket.IO broadcast — section events publish to \*\*both\*\* `room:<sectionId>` and `room:<parentCompositeId>`.

7\. Audit.

8\. Release.



Graph failure after lock acquired: release, surface error, no DB write, no broadcast.



\## Permissions



```ts

canUserBookRoom(user, room):

&#x20; user.isAdmin                            -> true

&#x20; room.allowedGroups.length === 0         -> true

&#x20; else groupIds intersects allowedGroups

```



Composite (whole room): user must satisfy every section's `allowedGroups` \*\*and\*\* the composite's own. Fail → `NotPermittedError` → 403.



\## Visibility — always server-side in `lib/booking/visibility.ts`



\- \*\*Room list:\*\* staff see all; students see only bookable rooms by default, with a "show all" toggle that reveals others as free/busy only.

\- \*\*Booking detail on someone else's booking:\*\*

&#x20; - Own bookings: full detail.

&#x20; - Student-organised: "Busy" to everyone except admins.

&#x20; - Staff-organised: full to staff, "Busy" to students.



Never trust the client to filter. Strip before serialisation.



\## Composite rooms — the gotchas



\- COMPOSITE has `mailboxUpn = null`; sections each have their own.

\- Webhook dedup key is `iCalUId` (one composite booking arrives N times).

\- No subscription on the composite itself.

\- A SECTION-scoped iPad never offers whole-room bookings, even if all sections are free.



\## Project layout



```

app/(portal)/        MSAL-auth web portal

app/(display)/       device-token iPad UI

app/api/             auth, bookings, rooms, devices, webhooks/graph, ws

lib/graph/           Graph client + subscriptions (app creds only)

lib/auth/            MSAL, sessions, group resolution

lib/booking/         pure logic: conflicts, permissions, visibility

lib/realtime/        Socket.IO + Redis lock

lib/db/              Prisma

lib/config/          zod env + YAML loaders

config/rooms.yaml    room metadata, allowedGroups, composite hierarchy

config/groups.yaml   staff\_groups, admin\_group

prisma/schema.prisma

docs/runbooks/

```



`(portal)` and `(display)` never import each other. Shared code → `lib/` or `components/shared/`.



\## Conventions



\- \*\*UI:\*\* portal uses shadcn/ui. Display uses bespoke full-screen; min 32pt body, 64pt status, ≥56pt targets; portrait 1024×1366 only.

\- \*\*Status colours:\*\* `--status-free`, `--status-busy`, `--status-soon` in `globals.css`. Never hard-code.

\- \*\*Dates:\*\* UTC everywhere, render in `Europe/London`, conversions via `date-fns-tz`.

\- \*\*Composite displays:\*\* 2–4 section cards + one shared QR.



\## Testing



\- Vitest unit tests for `lib/booking/` pure functions.

\- Graph wrappers use recorded-response fake in `lib/graph/\_\_mocks\_\_/` — run offline.

\- Playwright happy paths against the M365 Dev tenant. Never against production.



\## Don't



\- Migrate irreversibly.

\- Call Graph from client components.

\- Store Microsoft user tokens.

\- Add polling as a WebSocket fallback — fix the socket.

\- Let the iPad hit Graph directly.

\- Treat the QR token as auth.

\- Read Graph `organizer` to identify the booker.

\- Introduce a second source of truth (draft bookings not in Exchange).

\- Trust the client to filter visibility.

\- Pre-build for multi-instance.



\## How to work



\*\*Think first.\*\* State assumptions. Surface tradeoffs. If multiple interpretations exist, present them — don't pick silently. If something's unclear, stop and ask.



\*\*Minimum code.\*\* Nothing speculative. No abstractions for single-use code. No "flexibility" that wasn't requested. No error handling for impossible scenarios. If 200 lines could be 50, rewrite.



\*\*Surgical changes.\*\* Touch only what the request demands. Don't "improve" adjacent code or refactor things that aren't broken. Match existing style. Remove imports/symbols \*your\* changes orphaned; flag pre-existing dead code rather than deleting it.



\*\*Verifiable goals.\*\* Reframe vague tasks into checks:

\- "Add validation" → write failing tests for invalid inputs, then pass them.

\- "Fix the bug" → write a reproducing test, then pass it.

\- "Refactor X" → tests pass before and after.



For multi-step work, state the plan with a verify-step on each line before starting.


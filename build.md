# build.md

Technical design for the Room Booking Platform. This document is the architectural reference — if you're making a decision that contradicts it, update this document as part of the change.

## 1. Goals and non-goals

### Goals

- Staff and students can see every room they're permitted to book in one place, with live availability
- Permission to book each room is governed by Entra ID (Microsoft 365) group membership
- Some rooms are partitionable — bookable either as a whole or as one of several sections
- iPad displays outside rooms show live status and let users initiate a booking by scanning a QR code with their phone
- Updates propagate to all surfaces within a few seconds of any change
- Our portal is the only path that books rooms — Outlook and Teams cannot book rooms directly. This is enforced at the Exchange mailbox level

### Non-goals (for MVP)

- Booking approval workflows — if a user is permitted to book a room, they can self-book it without further approval
- Recurring booking creation from our UI — these are uncommon at this scale and can be added later if needed
- Public-facing booking — internal only
- Catering, AV setup requests, or other adjunct services
- Integration with the timetable / MIS

### Scale

The system is sized for roughly 20-50 rooms and up to ~1,500 staff and students at a single college. The design is deliberately simple at this scale — one application instance, no horizontal scaling, no cross-instance coordination. If the system ever grows substantially beyond that, the architecture will need revisiting; we will not pre-build for it.

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Microsoft 365 Tenant                      │
│  ┌──────────────────┐      ┌──────────────────────────────┐     │
│  │ Entra ID (Auth)  │      │  Exchange Online             │     │
│  │  - Staff/student │      │   - Room mailboxes           │     │
│  │  - Groups        │      │     (locked: only our app    │     │
│  │  - App registr.  │      │      can write)              │     │
│  └────────┬─────────┘      └──────────────┬───────────────┘     │
│           │                               │                     │
│           │            Microsoft Graph    │                     │
│           └─────────────────┬─────────────┘                     │
└─────────────────────────────┼───────────────────────────────────┘
                              │ HTTPS + change notifications
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                Railway                                          │
│  ┌──────────────────────────▼────────────────────────────┐      │
│  │               Next.js app (one instance)              │      │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │      │
│  │  │ Auth (MSAL)  │ │ Graph client │ │ Webhook recv │   │      │
│  │  └──────────────┘ └──────────────┘ └──────────────┘   │      │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │      │
│  │  │ Booking svc  │ │ Socket.IO    │ │ Cron jobs    │   │      │
│  │  │ (lock+write) │ │ (in-process) │ │ (sub renew,  │   │      │
│  │  │              │ │              │ │  resync, etc)│   │      │
│  │  └──────┬───────┘ └──────────────┘ └──────────────┘   │      │
│  └─────────┼─────────────────────────────────────────────┘      │
│            │                                                    │
│  ┌─────────▼────┐    ┌──────────────┐                           │
│  │  Postgres    │    │   Redis      │                           │
│  │   - rooms    │    │  - lock      │                           │
│  │  - bookings  │    │  - MSAL cache│                           │
│  │   - devices  │    └──────────────┘                           │
│  │   - users    │                                               │
│  │   - audit    │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘

   Users ──► portal (web)              Users ──► iPad displays
                                                (PWA, QR code)
```

The application runs on Railway as a single service, with Railway-managed Postgres and Redis attached. Microsoft 365 is the only external integration: Entra ID for authentication, Exchange for the room calendars themselves. Our app is the only writer to the room mailboxes — Exchange is configured to reject any other write — and it owns the policy for who can book what.

## 3. Data model

Prisma schema, simplified:

```prisma
model Room {
  id                String     @id @default(cuid())
  mailboxUpn        String?    @unique           // null for COMPOSITE rooms
  displayName       String
  building          String?
  floor             String?
  capacity          Int
  equipment         String[]                     // ["projector", "whiteboard"]
  bookable          Boolean    @default(true)
  timezone          String     @default("Europe/London")

  kind              RoomKind   @default(STANDARD)  // STANDARD | COMPOSITE | SECTION
  parentRoomId      String?
  parent            Room?      @relation("RoomSections", fields: [parentRoomId], references: [id])
  sections          Room[]     @relation("RoomSections")

  allowedGroups     String[]                     // Entra group object IDs. Empty = any signed-in user.

  bookings          Booking[]
  devices           Device[]
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
}

enum RoomKind {
  STANDARD   // a normal bookable room
  COMPOSITE  // a partitionable room — no mailbox of its own, has sections
  SECTION    // a section of a composite room — has its own mailbox
}

model Booking {
  id                String   @id @default(cuid())
  graphEventId      String   @unique           // event id on the *primary* room mailbox
  graphICalUid      String                     // stable id across mailboxes (composite bookings appear on N mailboxes with same iCalUId)
  roomId            String                     // the logical room booked: a STANDARD, a SECTION, or a COMPOSITE
  room              Room     @relation(fields: [roomId], references: [id])
  organiserUpn      String                     // the real organiser (a staff or student UPN)
  organiserName     String
  subject           String
  startUtc          DateTime
  endUtc            DateTime
  isAllDay          Boolean  @default(false)
  source            BookingSource              // PORTAL | IPAD_QR
  lastSyncedAt      DateTime @default(now())

  @@index([roomId, startUtc, endUtc])
  @@index([graphICalUid])
}

enum BookingSource {
  PORTAL
  IPAD_QR
}

model Device {
  id               String       @id @default(cuid())
  roomId           String                                  // the room this device represents
  room             Room         @relation(fields: [roomId], references: [id])
  scope            DeviceScope                             // STANDARD | SECTION | COMPOSITE
  pairingCode      String?                                 // short-lived, for setup
  tokenHash        String                                  // argon2 of device token
  lastSeenAt       DateTime?
  enrolledAt       DateTime     @default(now())
  name             String?                                 // "iPad outside Hall main entrance"

  @@index([roomId])
}

enum DeviceScope {
  STANDARD   // device represents one standard room
  SECTION    // device represents one section of a composite
  COMPOSITE  // device represents a composite room — books any section or the whole thing
}

model User {
  upn              String   @id              // staff or student email
  displayName      String
  isStaff          Boolean                   // computed at sign-in from group membership
  isAdmin          Boolean  @default(false)  // computed at sign-in from group membership
  groupIds         String[]                  // cached Entra group ids, refreshed each sign-in
  lastLoginAt      DateTime?
}

model GraphSubscription {
  id               String   @id              // Graph subscription id
  resource         String                    // /users/{upn}/events
  roomId           String
  expiresAt        DateTime
  clientState      String                    // random, we validate against this
  createdAt        DateTime @default(now())

  @@index([roomId])
  @@index([expiresAt])
}

model AuditLog {
  id               String   @id @default(cuid())
  actor            String                    // upn or "device:{id}" or "system"
  action           String                    // "booking.create", "booking.cancel.admin", etc
  targetId         String?
  metadata         Json
  at               DateTime @default(now())

  @@index([at])
  @@index([actor, at])
}
```

The `Booking` table is a **cache** of Exchange. The `Room`, `Device`, `User`, and `AuditLog` tables are **original data** — only here.

Notes on the model:

- A `COMPOSITE` room has no mailbox (`mailboxUpn` is null) and exists only in our database. Its sections each have their own mailbox.
- A `SECTION` row has `parentRoomId` set to its composite. Sections have their own `allowedGroups` and can have their own iPad.
- `allowedGroups` is empty for "any signed-in user." Otherwise it's a list of Entra group object IDs, and a user must be in at least one of them.
- For a composite room, the effective rule for booking the whole composite is *the union*: the user must satisfy every section's `allowedGroups` AND the composite's own `allowedGroups` (if set). This means you can never book the whole composite if you wouldn't be allowed to book any of its sections individually.
- One iPad represents one room (standard, section, or composite). A composite room may also have an iPad pointing at each of its sections — `roomId` is **not unique** on `Device`, but in practice a section or standard room has at most one device.

## 4. Microsoft 365 integration

### App registration

One app registration in Entra ID with:

- **Delegated permissions:** `User.Read`, `GroupMember.Read.All` — used only to identify the signed-in user and fetch their group memberships at sign-in. No delegated calendar permissions are required.
- **Application permissions:** `Calendars.ReadWrite` — used for **all** calendar reads and writes, scoped to room mailboxes via Exchange Application Access Policy.
- Redirect URI for the staff/student portal: `/api/auth/callback/azure-ad`
- Client secret stored in Railway environment variables

This is a deliberate change from earlier designs: writes are now made under application identity, not delegated. The rationale is in section 6.

### Application Access Policy

Application permissions on `Calendars.ReadWrite` would otherwise grant our app access to every mailbox in the tenant — unacceptable. We create an Application Access Policy that restricts our service principal to a mail-enabled security group containing only the room mailboxes:

```powershell
New-ApplicationAccessPolicy `
  -AppId <our-app-id> `
  -PolicyScopeGroupId room-mailboxes@college.ac.uk `
  -AccessRight RestrictAccess `
  -Description "Room booking platform — rooms only"
```

This **must** be in place before first deploy. Without it the app has tenant-wide mailbox access. Documented in `docs/runbooks/room-mailbox-provisioning.md`.

### Room mailbox lockdown

Every room mailbox in the system is configured so that **only our app can write to it.** No user — staff, student, or admin — can invite a room to a meeting in Outlook and have it succeed. The configuration on each mailbox:

```powershell
Set-CalendarProcessing -Identity <room-mailbox> `
  -AutomateProcessing AutoAccept `
  -AllBookInPolicy $false `
  -BookInPolicy @() `
  -AllRequestInPolicy $false `
  -AllRequestOutOfPolicy $false `
  -AddOrganizerToSubject $false `
  -DeleteSubject $false `
  -DeleteComments $false `
  -RemovePrivateProperty $false
```

The combination of `AllBookInPolicy = $false` and empty `BookInPolicy` means no user can directly book the room. Our app, writing under application permission via Graph, is unaffected by these policies — it writes directly to the mailbox calendar without going through the resource-booking attendant.

This is the architectural guarantee that our portal is the only booking path. Users who try to invite a room in Outlook receive an auto-decline. This is intentional and is communicated to users at onboarding.

### Graph endpoints we use

| Purpose | Endpoint | Auth |
|---|---|---|
| List events for a room | `GET /users/{roomUpn}/calendarView?startDateTime=...&endDateTime=...` | App |
| Create booking | `POST /users/{roomUpn}/events` | App |
| Update booking | `PATCH /users/{roomUpn}/events/{id}` | App |
| Cancel booking | `DELETE /users/{roomUpn}/events/{id}` | App |
| Subscribe to changes | `POST /subscriptions` on `/users/{roomUpn}/events` | App |
| Renew subscription | `PATCH /subscriptions/{id}` | App |
| Fetch user's groups at sign-in | `GET /me/transitiveMemberOf?$select=id` | Delegated |

### Booking organiser identity (important)

Because we write under application identity, the `organizer` field on the Graph event is the room mailbox itself, not the real human organiser. We compensate as follows:

- The **real organiser** is stored in our `Booking.organiserUpn` / `organiserName` columns.
- The real organiser is also stored on the Graph event as a **single-value extended property** named `OrganiserUpn`, so the truth is recoverable from Graph alone if our database is ever lost.
- The event's `subject` is set to `"[Organiser Name] — [User Subject]"` so the booking is identifiable in Outlook even without our system reading the extended property.
- The real organiser is added to the event as a **required attendee**, so the meeting appears on their own Outlook/Teams calendar. They cannot edit it directly in Outlook — only via our portal — because Exchange rejects writes to the room mailbox from anyone other than our app.

Users are informed at onboarding that booking edits happen in the portal, not Outlook. Their own calendar's meeting is a read-only mirror.

### Booking provenance via extended property

In addition to `OrganiserUpn`, every booking carries:

- `Source`: `PORTAL` or `IPAD_QR`, used in analytics ("how often do people book at the door?")
- `BookingId`: our internal `Booking.id`, used to correlate webhook notifications

### iPad-to-portal handoff via QR code

The iPad never authenticates anyone and never writes to Graph. Each iPad displays a QR code encoding a deep link to the portal.

Three iPad scopes:

- **STANDARD** — outside a standard room. QR encodes `/r/{roomId}?from=display&t={token}`. Lands on the booking dialog for that one room.
- **SECTION** — outside one section's door. QR encodes `/r/{sectionId}?from=display&t={token}`. Lands on the booking dialog for that section. **Cannot** be used to book the whole composite or sibling sections.
- **COMPOSITE** — outside the composite's main entrance. QR encodes `/r/{compositeId}?from=display&t={token}`. Lands on a chooser page: "Book Hall-A", "Book Hall-B", "Book Hall-C", or "Book the whole Hall" (greyed out if any section isn't free for the chosen time).

When a user scans:

1. Their phone opens the URL in the default browser.
2. If they aren't signed in, MSAL signs them in (state preserves the original URL).
3. The destination page renders with sensible defaults pre-filled. Start time = now rounded to the next 15 minutes; duration capped at the next conflict.
4. The booking permission check runs server-side when they submit. A student attempting to book a staff-only room sees a polite "you can't book this room" message after sign-in, with a link to "find rooms you can book."

The `t` parameter is a short-lived signed token (HMAC, 5-minute TTL, signed by a secret in Railway env vars) generated by the iPad's display session and rotated periodically. It proves the scan happened in front of *that specific iPad* recently, lets us tag `source = IPAD_QR`, and prevents reuse of photographed QR codes. It is **not** an authorisation primitive — the portal still requires a fully authenticated MSAL session.

### Change notifications (webhooks)

We subscribe one Graph subscription per room mailbox on its `events` resource. Each subscription:

- Points to `https://<our-domain>/api/webhooks/graph`
- Carries a random `clientState` we validate on every notification
- Expires after ~4230 minutes (Graph's max for calendar resources)
- Is renewed by a cron job that runs every 6 hours

Since our app is the only writer, the webhook is mostly a safety net — it confirms our writes landed, and it catches the rare case where an admin makes a manual change in Exchange. We still process notifications defensively. Notifications are lightweight; we fetch the event details from Graph and update our cache.

Composite-room bookings appear as one Graph event on each invited section mailbox (same `iCalUId`, different per-mailbox event ids). We dedupe on `iCalUId` so a composite booking results in exactly one `Booking` row in our database. Section subscriptions exist per section mailbox; the composite has no mailbox and no subscription of its own.

## 5. Authentication and authorisation

### Sign-in flow

Standard OAuth2 Authorization Code + PKCE via MSAL, used by staff and students alike:

1. User hits the portal, no session → redirect to Entra
2. Sign in, consent (first time only), redirect to `/api/auth/callback`
3. We exchange code for tokens; we use the delegated token *once* to call `GET /me` and `GET /me/transitiveMemberOf?$select=id`
4. We upsert the `User` row with display name and the resolved group IDs; we set `isStaff` and `isAdmin` flags by intersecting against the configured staff/admin groups
5. We **discard the user's Graph token** — it is not used for any subsequent operation, and we don't need a refresh token because every backend call after this point is made with application credentials
6. We issue a session cookie (HTTP-only, Secure, SameSite=Lax, 8-hour sliding, 30-day absolute) referencing a small Redis-backed session record

Session record contents:

```ts
{
  upn: string,
  displayName: string,
  groupIds: string[],
  isStaff: boolean,
  isAdmin: boolean,
  signedInAt: string,
}
```

Group membership is refreshed on every fresh sign-in. Maximum staleness in practice is the session lifetime (8h sliding). If an admin needs to change someone's permissions immediately, they can revoke the user's session from the admin tools.

### Booking permission check

Before any booking write, we run:

```ts
function canUserBookRoom(user: SessionUser, room: Room): boolean {
  if (user.isAdmin) return true;                       // admins can book any room
  if (room.allowedGroups.length === 0) return true;    // open room
  return user.groupIds.some(g => room.allowedGroups.includes(g));
}
```

For a composite-room booking (whole room), the check runs against every section's `allowedGroups` as well as the composite's own. The user must satisfy all of them.

A failing check yields `NotPermittedError` → HTTP 403 with a clear message. Admin bypasses are audited explicitly with `metadata.adminOverride = true`.

### "Staff" vs "student"

Our system does not have separate auth flows or roles for staff and students. They both sign in with their college Microsoft account. The distinction lives entirely in group membership:

- A `staff_groups` list in `config/groups.yaml` (committed to the repo) names the Entra groups that constitute "staff." A user is staff if they're in any of them.
- A single `admin_group` ID in the same file names the Entra group whose members are admins of the room booking platform itself.
- Everyone else who can sign in is treated as a student / general user.

This means there is one auth code path. The user's group memberships determine what they can see and book.

### iPad devices (device token)

The iPad has its own identity for reads only. Pairing flow:

1. Admin opens the portal, navigates to a room, clicks "Pair display"
2. Admin chooses the scope for this device:
   - For a standard room: implicit
   - For a composite room: "Book just one section" (admin picks which) → SECTION; or "Whole room with section picker" → COMPOSITE
3. Portal generates a 6-digit pairing code (10-minute TTL) and shows it
4. Admin opens the display app on the iPad and enters the code (or scans an admin-side QR encoding the enrolment URL)
5. iPad POSTs `/api/devices/enroll` with the code
6. Backend verifies, generates a long-lived device token (256-bit random, hashed with Argon2id, stored in `Device.tokenHash`), returns it once
7. iPad stores the token in secure storage via the PWA wrapper

Every subsequent iPad request carries `Authorization: Bearer <device-token>`. Hash and compare.

Device tokens authorise:

- Subscribing to live updates for the device's room (and, for COMPOSITE scope, all its sections too)
- Reading that room's current and upcoming bookings
- Minting short-lived QR tokens

Device tokens **cannot** create, edit, or delete bookings. Those paths require an authenticated user session.

Device tokens don't expire but can be revoked from the portal. Lost iPad → admin revokes; iPad goes offline; new pairing required.

## 6. Booking write path

```
Portal/QR ─► API ─► [permission check] ─► [lock] ─► cache check ─► Graph write ─► DB write ─► Socket.IO broadcast ─► [unlock]
                                                                                          │
                                                                                          ▼
                                                                                       audit
```

Pseudocode for `createBooking`:

```ts
async function createBooking(input: BookingInput, user: SessionUser): Promise<Booking> {
  // 1. Permission check
  const room = await db.room.findUniqueOrThrow({ where: { id: input.roomId }, include: { sections: true, parent: true } });
  if (!canUserBookRoomFully(user, room)) throw new NotPermittedError(room);

  // 2. Lock — by parent id for composite-family bookings, else by room id
  const lockKey = `lock:room:${room.kind === "SECTION" ? room.parentRoomId : room.id}`;
  const lock = await redis.acquireLock(lockKey, { ttlMs: 5000, retries: 3 });
  if (!lock) throw new ConflictError("Room is being booked by someone else, try again");

  try {
    // 3. Cache check
    const targets = resolveMailboxesForBooking(room);
    //   STANDARD/SECTION → [room itself]
    //   COMPOSITE        → all section mailboxes
    const conflicts = await db.booking.findMany({
      where: {
        roomId: { in: targetsAffectedRoomIds(room) },
        startUtc: { lt: input.endUtc },
        endUtc:   { gt: input.startUtc },
      },
    });
    if (conflicts.length > 0) throw new ConflictError("Room not available");

    // 4. Graph write (application identity, one event with N invited resources for composite)
    const event = await graph.createEvent(primaryMailbox(targets), {
      subject: `${user.displayName} — ${input.subject}`,
      start: input.startUtc,
      end:   input.endUtc,
      attendees: [
        ...targets.map(m => ({ emailAddress: { address: m.mailboxUpn }, type: "resource" })),
        { emailAddress: { address: user.upn, name: user.displayName }, type: "required" },
      ],
      singleValueExtendedProperties: [
        { id: "String {guid} Name OrganiserUpn", value: user.upn },
        { id: "String {guid} Name Source",       value: input.source },
      ],
    });

    // 5. DB write
    const booking = await db.booking.create({
      data: {
        graphEventId: event.id,
        graphICalUid: event.iCalUId,
        roomId: room.id,
        organiserUpn: user.upn,
        organiserName: user.displayName,
        subject: input.subject,
        startUtc: input.startUtc,
        endUtc:   input.endUtc,
        source: input.source,
      },
    });

    // 6. Broadcast — to this room's channel and, for sections, the parent composite's channel too
    socketIo.publish(channelsFor(room), { type: "booking.created", booking: serialize(booking) });

    // 7. Audit
    await audit.log({
      action: "booking.create",
      actor: user.upn,
      targetId: booking.id,
      metadata: { source: input.source, kind: room.kind, ...(user.isAdmin && { adminOverride: false }) },
    });

    return booking;
  } finally {
    await lock.release();
  }
}
```

Key points:

- **The permission check is ours, not Exchange's.** Exchange will accept any write our app makes — it has no knowledge of `allowedGroups`. The portal is the gate.
- **We are the only writer.** This means our cache is sufficient for the conflict check; nothing else has touched the mailbox between our read and our write, because the lock serialises our own concurrent attempts. (The webhook handler is the safety-net for the unlikely case that someone with mailbox admin privileges makes a change in Exchange directly.)
- **Composite bookings are one Graph event, not N.** A single event with multiple invited resources. Exchange auto-accepts each resource. No verification-and-rollback dance is needed because no other writer can race us.
- **The actor is always a real authenticated user.** The application credentials are how we *write to Exchange* but they are not the *organiser*. The organiser is the signed-in person; the audit log proves it.

Cancellations: `DELETE /events/{id}` via app credentials. Section mailboxes' calendars clear automatically because Exchange removes the meeting from all invited resources. One DB delete, one broadcast, one audit row.

Edits: `PATCH /events/{id}` via app credentials. Authorisation: only the original organiser (matched against `Booking.organiserUpn` and verified against the `OrganiserUpn` extended property as a cross-check) or an admin.

## 7. Real-time delivery

### Transport

Socket.IO embedded in the Next.js custom server (Node runtime, not Edge). One application instance, so Socket.IO runs in-process — no Redis pub/sub fan-out needed. If the system ever needs more than one instance, adding `@socket.io/redis-adapter` is a small change, but for now it's unnecessary and we are deliberately not building for it.

### Authentication at handshake

- **Portal clients:** present the session cookie during handshake; server resolves to a UPN and the user's permitted rooms.
- **iPad clients:** present `Authorization: Bearer <device-token>`; server resolves to a device and its room (and, for COMPOSITE scope, its sections).
- Unauthenticated handshakes are rejected.

### Channels

Each room has a logical channel `room:<roomId>`. A SECTION's events are broadcast on both `room:<sectionId>` and `room:<parentCompositeId>` so a client watching the composite sees section-level changes.

- **Portal clients** subscribe to rooms based on the currently visible filters; capped at 50 rooms per client.
- **iPad clients** auto-subscribe at handshake — to one room for STANDARD/SECTION scope, to the composite and all its sections for COMPOSITE scope.

### Message shape

```ts
type RealtimeMessage =
  | { type: "booking.created"; booking: BookingDTO }
  | { type: "booking.updated"; booking: BookingDTO }
  | { type: "booking.deleted"; roomId: string; graphEventId: string }
  | { type: "room.updated"; room: RoomDTO };
```

Every message has an `id`, `at`, and `payload` envelope. Clients dedupe on `id` and ignore out-of-order arrivals based on `at`.

### Reconnect

On reconnect, the client receives a snapshot per subscribed room covering now+48h, computed from the Postgres cache. Then normal message stream resumes. The display also re-fetches a fresh QR token from `/api/devices/qr-token`.

## 8. Frontend

### Staff/student portal (`app/(portal)/`)

Key routes:

- `/` — room grid. Cards show name, building/floor, capacity, equipment, and a live status pill. Filters: availability, capacity, building/floor, equipment.
- `/rooms/[id]` — room detail with timeline for today + next 7 days. For composite rooms, this view shows sections as horizontal lanes plus a "whole room" lane.
- `/r/[id]` — short alias used by iPad QR codes. Opens directly into a booking dialog or, for composite-iPad scans, into a chooser page. Mobile-first.
- `/bookings` — my upcoming bookings, with edit/cancel actions.
- `/profile` — name, email, last sign-in.
- `/admin` — visible to admins only. Room metadata, device pairing, audit log, user session revoke.

### Visibility rules

These apply on every read path:

- **Room visibility.** A non-staff user (i.e. a student) by default sees only rooms they're permitted to book. A "show all rooms" toggle reveals every room as free/busy, but with no subject or organiser shown. Staff see every room by default.
- **Booking detail visibility.** A user always sees their own bookings in full. Otherwise:
  - Staff see subject and organiser of all bookings *except* those organised by a non-staff user, where subject is replaced with "Busy" and the organiser is hidden.
  - Non-staff users see other people's bookings as "Busy" only — no subject, no organiser — regardless of who organised them.

The intent is that student timetable details (subjects like "Maths GCSE — Year 11", student names) are not displayed across the system. Students seeing their own bookings is fine; everything else is anonymised to "Busy" with the time range.

### Composite room UX

- The room grid shows a composite room as a single card with a small per-section availability strip ("Hall: A free · B busy · C free").
- The room detail page shows a multi-lane timeline.
- The booking dialog on a composite room asks "the whole room or one section?" — the user picks, then sets the time. The "whole room" option is disabled with a tooltip if any section conflicts with the chosen window.

### iPad display (`app/(display)/`)

Single route: `/display` reads the device token, resolves device → room → scope, and renders one of three layouts:

**STANDARD / SECTION (single-room display):**

- FREE — full-bleed `--status-free`, room name in very large type, capacity, prominent QR code, next booking preview at bottom.
- BUSY — full-bleed `--status-busy`, current subject (or "Busy" if organised by a non-staff user, or marked private), organiser name (if shown), end time, next free slot. QR remains visible but subordinate.
- SOON — `--status-soon`, countdown to next booking, QR present.

**COMPOSITE (multi-section dashboard):**

- The screen is divided into sections (2-4 typical), each rendered as a smaller card with its own current status, current/next booking, and a brief label.
- A single prominent QR sits at the top or centre of the screen, captioned "Scan to book any section or the whole room."
- The QR encodes the composite room id; the scan lands on the chooser page.

A subtle health badge in the corner shows `live | cached | offline` only when not fully live. In offline mode the QR is replaced with "Refreshing — please book from your desk" after the most recent QR has expired.

## 9. Background jobs

Run in-process using `node-cron`. No separate worker service — for our scale, cron-in-process is simpler and reliable. Jobs are designed to be idempotent and crash-safe (mid-run failure is recovered by the next run).

| Job | Schedule | What it does |
|---|---|---|
| `subscription-renewer` | every 6h | Renews Graph subscriptions within 24h of expiry |
| `full-resync` | nightly 02:00 | Reconciles DB against Graph for every room mailbox — repairs any missed notifications |
| `device-heartbeat-check` | every 15m | Flags iPads silent >2h, notifies admins if >6h |
| `audit-prune` | weekly (Sun 03:00) | Deletes `AuditLog` rows older than 2 years |

## 10. Deployment

### Hosting

- **Railway** runs the Next.js app as a single service. Deploys from git on push to `main`.
- **Railway Postgres** add-on, attached via injected `DATABASE_URL`.
- **Railway Redis** add-on, attached via injected `REDIS_URL`.
- **Custom domain** `rooms.college.ac.uk` pointed at the Railway service.

### Environments

- **Local dev:** docker-compose for Postgres and Redis, `pnpm dev`. Connects to a Microsoft 365 Developer tenant with test room mailboxes.
- **Production:** Railway. There is no separate staging environment — the system is new and not yet in use, so we deploy to production and verify against real rooms. If we ever need an isolated staging environment we'll add one as a Railway environment alongside production.

### Secrets

Everything in Railway environment variables. No secrets in git. Rotation runbooks (section 12) cover the client secret, the QR signing key, and device tokens.

### Config validation

`lib/config.ts` validates env vars at boot using zod. Missing or malformed config fails loudly on startup. No silent fallbacks.

## 11. Observability

For our scale, Railway's built-in logs and metrics are sufficient. We don't add a separate observability stack.

- **Structured logging** via Pino, one JSON line per event, surfaced in Railway's log viewer.
- **A simple `/api/health` endpoint** returns status of: Postgres connectivity, Redis connectivity, Graph subscription health (latest renewal success). Used for the Railway healthcheck and for an admin-visible status indicator in the portal footer.
- **Key counters** logged at structured-log level (no metrics stack required at this scale): bookings created, Graph errors, webhook arrivals, subscription renewals.

If/when usage grows enough to justify it, we can add an external observability provider; the structured logs are already in the shape that providers expect.

### Alerts

The system is small. There is no PagerDuty-style on-call rota. Operational notifications are sent by email to a `room-booking-admins@college.ac.uk` distribution group:

- Subscription renewer has failed twice in a row → email immediately
- Graph 5xx rate >10% over 15 min → email
- Any iPad silent >6h during school hours → email
- Nightly resync failed → email

Daily life: an admin glances at the dashboard tile in the portal admin section ("Status: All systems healthy") and only investigates when an email arrives.

## 12. Security and privacy

- HTTPS everywhere via Railway's automatic TLS.
- Strict Content Security Policy on portal and display routes; no `unsafe-inline`, no `unsafe-eval`.
- Device tokens are bearer credentials — never logged, never sent back to the client after enrolment.
- QR tokens are short-lived HMAC values; the signing key lives in env vars. Tokens are never logged in full (signature prefix only).
- Rate limits: 5 booking creations per user per minute; 100 reads per user per minute; 60 QR-token mints per device per hour.
- Audit log is append-only — no UI exposes delete or update on audit rows.
- The Application Access Policy is the security boundary that limits our app's blast radius to room mailboxes.
- The room mailbox lockdown (`AllBookInPolicy = $false`) is the boundary that enforces "portal is the only writer."

### Retention

- Bookings in our DB: as long as they exist in Exchange.
- Audit logs: 2 years (pruned automatically by a weekly cron job).
- Device tokens: until revoked.
- Session records in Redis: 30 days max.

### Rotation

- Client secret: every 12 months. Runbook documents the swap.
- QR signing key: every 12 months. Old key remains valid for 24h after rotation.

## 13. Accessibility

- Portal meets WCAG 2.2 AA. axe-core runs in CI on every PR.
- iPad display: high-contrast in all states; minimum 32pt body, 64pt for status; all interactive targets ≥56pt.
- Screen-reader labels on the display announce status and next booking.
- Keyboard navigation works throughout the portal even though the display is touch.
- Internal accessibility review before launch. No external audit at this scale; if college policy requires one, we add it.

## 14. Open questions

These remain undecided and should be resolved during the build:

1. **Staff without smartphones.** The QR flow assumes a phone with a camera. The printed-fallback URL on each iPad mount addresses this, but we should validate the experience with staff who fall into this category during pilot.
2. **Cellular/Wi-Fi reach.** Some rooms (basements, far corners) may have weak signal. The mount checklist requires verification at install; where it fails, additional APs are deployed before the iPad goes in.
3. **Composite-room subject convention.** When the whole composite is booked, do we set the same subject on all section mailboxes, or annotate ("Subject — Hall-A of 3")? Default position: same subject on all; revisit if it causes confusion in Outlook calendars.
4. **Student bookings of staff-organised meetings as attendees.** If a teacher books a study room and adds a student as an attendee, the student sees the booking. That's correct under the visibility rules (it's their own booking).
5. **Admin override of permission check.** Admins can book any room. Should there be a "book on behalf of" feature for genuine cases? Not in MVP; revisit if asked for.

## 15. References

- Microsoft Graph — Calendar API: https://learn.microsoft.com/graph/api/resources/event
- Application Access Policies: https://learn.microsoft.com/graph/auth-limit-mailbox-access
- Change notifications: https://learn.microsoft.com/graph/change-notifications-overview
- Set-CalendarProcessing: https://learn.microsoft.com/powershell/module/exchange/set-calendarprocessing
- MSAL Node: https://learn.microsoft.com/entra/identity-platform/msal-node
- Next.js App Router: https://nextjs.org/docs/app
- Railway deployment docs: https://docs.railway.app
# Room Booking Platform

A Microsoft 365-integrated meeting and study room booking system for a sixth form college. Staff and students sign in with their college Microsoft account, see the rooms they're allowed to book, and book one — from a browser, or by scanning a QR code on the iPad mounted outside the room. Bookings are real calendar events on the room's Exchange mailbox, but the **portal is the only path that books rooms** — Outlook and Teams cannot directly book a room.

## What it does

**Web portal** — Sign in with your college Microsoft account and see every room you're permitted to book. Filter by availability, capacity, building, or equipment. Book a room in a few clicks and manage your upcoming bookings. Works on desktop and mobile browsers.

**iPad room displays** — A tablet mounted outside a room shows whether it's free or occupied, who's using it (subject to visibility rules), and when it's next available. The whole screen turns green when free and red when in use, so you can see the state from down the corridor. Each display also shows a QR code — scan it with your phone, sign in with your college Microsoft account, and book the room from the page that opens. The iPad itself never asks for credentials.

**Partitionable rooms (composite rooms)** — Some rooms have movable partitions. The system understands these: you can book the whole room or one section, and the two are mutually exclusive (booking the whole room prevents anyone booking a section, and vice versa). The iPad outside a partitionable room can either book a specific section, or — if mounted at the main entrance — present a chooser for any section or the whole room.

**Role-based access** — Each room has a list of Microsoft 365 groups whose members are allowed to book it. Study rooms might be open to everyone in the college. Meeting rooms might be staff-only. A board room might be limited to senior staff. The college's IT team controls group membership; we just look it up at sign-in.

## How it fits together

```
   Staff Portal    ──┐
                     │
   iPad Displays   ──┤
                     ├──► Microsoft Graph ──► Exchange Room Mailboxes
   Permission        │           (only our app can write)
   checks via    ──► │
   Entra groups      │
                     ▼
              Next.js backend
              + Postgres cache
              + Redis (lock, MSAL cache)
              on Railway

  Outlook/Teams direct bookings are rejected by Exchange.
  Real-time updates pushed to portal and iPads via WebSockets.
```

Exchange holds the booking events. Our backend is the only system allowed to write to the room mailboxes — this is enforced by Exchange via per-mailbox `BookInPolicy` settings. Our backend keeps a local mirror for fast reads and subscribes to Graph change notifications so it confirms its own writes landed and catches any out-of-band changes made by admins. When anything changes, connected portals and iPads are pushed the update over WebSockets.

## Tech stack

- **Next.js 15** (App Router) — portal and iPad UI in one codebase, with route groups separating the two experiences
- **TypeScript** end to end
- **Microsoft Graph API** — calendar reads and writes, accessed under application credentials scoped to room mailboxes via Exchange Application Access Policy
- **MSAL** (`@azure/msal-node`) — Microsoft sign-in for staff and students
- **Postgres** (via Prisma) — local cache of rooms, bookings, devices, users, and audit log
- **Redis** — booking lock and MSAL token cache
- **Socket.IO** — push updates to portals and iPads (in-process, single instance)
- **Tailwind CSS** + **shadcn/ui** — portal UI
- **Railway** for hosting (app, Postgres, Redis)

## Who this is for

Staff, students, and anyone else at the college with a Microsoft 365 account. Permission to book individual rooms is controlled per room via Microsoft 365 group membership — different rooms can be open to everyone, restricted to staff, or restricted to senior staff. The system is intended to run inside the college network and tenant — it is not a multi-tenant product.

## Getting started

### Prerequisites

- **Node.js 22+** and **pnpm 9+** (`npm install -g pnpm`)
- **Docker Desktop** (for local Postgres and Redis)
- A `.env.local` file — copy `.env.example` and fill in values (see below)

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/mrbs.git
cd mrbs
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`. The minimum required for local dev:

| Variable | Where to find it |
|---|---|
| `AZURE_TENANT_ID` | Azure portal → Entra ID → Overview → Tenant ID |
| `AZURE_CLIENT_ID` | App registrations → College Room Booking → Overview |
| `AZURE_CLIENT_SECRET` | App registrations → your app → Certificates & secrets |
| `SESSION_SECRET` | Generate: `openssl rand -base64 32` |
| `QR_SIGNING_KEY` | Generate: `openssl rand -base64 32` |

`DATABASE_URL` and `REDIS_URL` default to the docker-compose values — leave them as-is for local dev.

### 3. Start Postgres and Redis

```bash
docker compose up -d
```

Healthchecks are configured; wait ~5 seconds for both to be ready.

### 4. Initialise the database

```bash
pnpm prisma generate   # generate the Prisma client
pnpm prisma db push    # apply the schema to your local Postgres
```

### 5. Start the dev server

```bash
pnpm dev
```

Visit `http://localhost:3000/api/health` — you should see:

```json
{ "ok": true, "checks": { "postgres": true, "redis": true }, "errors": [] }
```

### 6. Run the Graph smoke test

This is the Phase 1 exit-criterion test. It verifies that app credentials work
and the Application Access Policy is correctly scoped.

```bash
pnpm smoke b12@college.ac.uk
```

Replace `b12@college.ac.uk` with a real room mailbox UPN from your tenant.
Expected output: the room's events for the next 7 days, or `(no events)` if the
calendar is empty.

If you see `Graph HTTP 403`, the Application Access Policy hasn't been created
yet — see [`docs/runbooks/room-mailbox-provisioning.md`](./docs/runbooks/room-mailbox-provisioning.md).

### 7. Run tests and lint

```bash
pnpm typecheck   # TypeScript type checking
pnpm lint        # ESLint
pnpm test        # Vitest unit tests
```

---

### Deploying to Railway

1. Create a Railway project. Add a **Postgres** and **Redis** add-on.
2. Connect the GitHub repo to the Railway service (deploy on push to `main`).
3. In Railway → Variables, add all the env vars from `.env.example` that are
   marked as user-set (everything except `DATABASE_URL` and `REDIS_URL`, which
   Railway injects automatically).
4. Set the healthcheck path to `/api/health` — it's already in `railway.toml`.
5. Push to `main`. Railway runs `pnpm install && pnpm prisma generate && pnpm build`,
   then `pnpm start`. The healthcheck confirms the deploy is live.

**Before going to production** — the Application Access Policy and mailbox lockdown
must be in place. Follow [`docs/runbooks/room-mailbox-provisioning.md`](./docs/runbooks/room-mailbox-provisioning.md) for every room.

---

## Status

Phases 1–7 complete. Phase 8 (full rollout) pending. See [`build.md`](./build.md) for the full technical design, the `Phases/` directory for the phase-by-phase build plan, and [`claude.md`](./claude.md) for the working rules.

## Documentation

- [`build.md`](./build.md) — architecture, data model, auth flows, Graph integration
- [`claude.md`](./claude.md) — conventions and constraints for AI-assisted coding
- [`phases/`](./phases/) — eight build phases from foundation through rollout
- [`docs/runbooks/`](./docs/runbooks/) — operational procedures

## License

Internal project. Not for external distribution.

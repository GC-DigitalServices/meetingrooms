# Threat model — MRBS

**Scope:** Meeting Room Booking System, Greenhead College.
**Method:** STRIDE per trust boundary.
**Last reviewed:** June 2026.

---

## Assets

| Asset | Sensitivity | Impact if compromised |
|-------|-------------|----------------------|
| Session tokens (Redis) | High | Impersonation — can book/cancel as any user |
| Exchange room mailboxes | High | Phantom bookings, calendar poisoning, DoS on rooms |
| Booking records (Postgres) | Medium | Privacy breach, operational disruption |
| Device pairing tokens (Postgres) | Medium | Rogue display device injected into the system |
| Audit log | Medium | Forensic loss, compliance failure |
| Graph app credentials (env) | Critical | Full tenant Graph access — must never be in code |
| QR HMAC signing key (env) | Low-Medium | Replayed QR tokens; limited by 5-min window |

---

## Actors

| Actor | Trust level | Notes |
|-------|-------------|-------|
| Authenticated staff | Low | Can book rooms within their group |
| Authenticated student | Low | Restricted room set; booking detail redacted |
| Admin user | Elevated | All rooms, overrides; override is audited |
| Paired iPad (device token) | Low | Single room/section scope; no write to Graph directly |
| Graph webhook (Microsoft) | External | Validated by HMAC client state |
| Unauthenticated internet | Untrusted | Public prefixes only: /sign-in, /terms, /api/auth/* |

---

## Trust boundaries

```
[Browser]
    │  HTTPS + session cookie (HttpOnly, Secure, SameSite=Lax)
    ▼
[Next.js server — Railway]
    │  App credentials (client_credentials)         ┐
    ├──────────────────────────────────────────────▶ [Microsoft Graph / Exchange Online]
    │  Prisma connection string (TLS)               │
    ├──────────────────────────────────────────────▶ [PostgreSQL — Railway private network]
    │  ioredis (TLS in prod)                        │
    ├──────────────────────────────────────────────▶ [Redis — Railway private network]
    │                                               │
    │  Graph change notification (inbound HTTPS)    │
    ◀───────────────────────────────────────────────┘
```

---

## STRIDE analysis

### 1 — Browser ↔ Next.js

#### Spoofing
- **Threat:** Attacker forges a session cookie.
- **Mitigation:** 256-bit random session ID stored in Redis; HttpOnly + Secure cookie; no value derivable from user attributes.
- **Residual:** Session fixation on sign-in path — mitigated because `/api/auth/callback` always issues a fresh session ID.

#### Tampering
- **Threat:** Attacker modifies request body to book a room they are not permitted to access.
- **Mitigation:** `canUserBookRoom` always runs server-side using the session's `groupIds`. Client cannot influence the permission check.
- **Residual:** None significant.

#### Repudiation
- **Threat:** User denies making or cancelling a booking.
- **Mitigation:** Audit log written for every booking create/update/cancel, including `actor`, `targetId`, timestamp, and admin-override flag. Audit rows are append-only by convention (no update/delete in application code).
- **Residual:** Audit log could be truncated by a compromised DB admin account.

#### Information disclosure
- **Threat:** Student sees full detail (subject, organiser) of a staff booking they should only see as "Busy".
- **Mitigation:** Visibility filtering runs in `lib/booking/visibility.ts` on the server before serialisation; never trusted from the client.
- **Threat:** JWT/token leaks via referrer headers or logging.
- **Mitigation:** Referrer-Policy: strict-origin-when-cross-origin; no tokens in URL params.

#### Denial of service
- **Threat:** Spam booking requests exhaust the Graph API quota or Redis lock contention.
- **Mitigation:** Rate limiter: 5 writes/user/60 s at the API layer. Redis lock with timeout prevents stacked retries.
- **Residual:** A compromised admin account has no rate limit (by design — admin bypass is audited, not blocked).

#### Elevation of privilege
- **Threat:** Non-admin user gains admin actions (delete any booking, view audit log).
- **Mitigation:** `requireSession` validates session from Redis; `session.isAdmin` derived at sign-in from Entra group membership, not from the request.
- **Threat:** Student enrols a device.
- **Mitigation:** Device enrolment (`POST /api/devices/enroll`) is admin-only.

---

### 2 — Next.js ↔ Microsoft Graph

#### Spoofing
- **Threat:** Attacker impersonates the Next.js server to issue Graph calls.
- **Mitigation:** App credentials are environment variables only; never exposed to the client. All Graph calls use the application token (`client_credentials`), not the user's delegated token.

#### Tampering
- **Threat:** Man-in-the-middle modifies Graph responses to inject bookings.
- **Mitigation:** TLS enforced for all Graph calls; MSAL validates the access token's signature.

#### Repudiation
- **Threat:** Graph write succeeds but local mirror is never written, creating a phantom booking.
- **Mitigation:** Booking write path order is enforced: Graph first, then Postgres inside the same `withLock` scope. Lock is released only after DB write. If Graph fails, no DB write occurs.

#### Information disclosure
- **Threat:** Graph app secret leaks.
- **Mitigation:** Secret stored in Railway secret variables; not in `.env` files checked into source; gitleaks CI scan blocks accidental commits.
- **Mitigation:** Secret rotation runbook: `docs/runbooks/secret-rotation.md`.

#### Denial of service
- **Threat:** Graph throttling causes booking writes to queue indefinitely.
- **Mitigation:** `graph:degraded` Redis key: first Graph failure sets a 15-min fail-fast flag; subsequent booking writes return `503` immediately rather than holding locks waiting for a slow Graph. `cron/sub_renew` emails IT if failures streak ≥ 2 consecutive runs.

#### Elevation of privilege
- **Threat:** Attacker registers a Graph change notification subscription to receive booking events.
- **Mitigation:** Subscriptions are created by the application only, using app credentials. Inbound webhook calls are validated by checking the `clientState` HMAC before processing.

---

### 3 — Graph webhook (inbound)

#### Spoofing
- **Threat:** Third party POSTs a fake change notification to `/api/webhooks/graph`.
- **Mitigation:** Every incoming notification must carry `clientState` matching the HMAC-SHA256 of the subscription ID signed with `QR_SIGNING_KEY` (repurposed as the shared secret). Invalid state → 401.
- **Residual:** The signing key is the same as the QR key; they are logically independent but share key material — consider splitting if the key rotation cadence diverges.

#### Tampering
- **Threat:** Attacker replays or modifies a valid notification to trigger a resync of a different resource.
- **Mitigation:** The `resourceId` in the notification is validated against known subscription IDs in Postgres before a resync is dispatched. Unknown resource IDs are silently dropped.

---

### 4 — Next.js ↔ Postgres / Redis

#### Spoofing
- **Threat:** Attacker connects to the database directly.
- **Mitigation:** Postgres and Redis are on Railway's private network; not accessible from the public internet without the Railway proxy.
- **Residual:** Connection strings in env vars must be rotated if the Railway project is compromised.

#### Information disclosure
- **Threat:** Postgres query logs expose PII.
- **Mitigation:** `pgaudit` is not enabled by default on Railway-managed Postgres; this is a known gap. PII in query logs is limited to UPNs and booking subjects.

#### Denial of service
- **Threat:** Redis crash causes all booking writes to fail (lock service unavailable).
- **Mitigation:** `withLock` has a 10-second timeout; callers surface a `LockTimeoutError`. Fail-fast `isGraphDegraded` check reads Redis before the lock — if Redis is down, `isGraphDegraded` fails open (returns `false`) so the write path can still proceed without the lock guard.
- **Residual:** If Redis is completely unavailable, no locking occurs. Conflict checks against Postgres still run, but concurrent race window exists for very-close concurrent writes.

---

### 5 — iPad (display) ↔ Next.js

#### Spoofing
- **Threat:** Rogue device presents a stolen device token.
- **Mitigation:** Device tokens are securely generated 256-bit randoms, hashed in Postgres. Compromised tokens can be revoked by an admin (`DELETE /api/devices/{id}`).

#### Elevation of privilege
- **Threat:** Display device calls a portal endpoint to create bookings.
- **Mitigation:** Display routes (`/display/*`, `/api/devices/*`) use device-token auth only. Portal booking endpoints use session-cookie auth; device tokens are not accepted.
- **Threat:** QR scan allows a photographed QR to be used later.
- **Mitigation:** QR token is HMAC-signed with a 5-minute TTL. Validated against the room's current device ID; tokens from another room are rejected.

---

## Residual risks (not fully mitigated)

| Risk | Severity | Owner | Accepted? |
|------|----------|-------|-----------|
| Redis unavailable → no distributed lock | Medium | IT Ops | Yes — single instance; Redis HA out of scope |
| Audit log not archived > 2 years | Low-Medium | IT / DPO | Pending — privacy retention job not yet built |
| `clientState` signing key shared with QR key | Low | Dev | Yes — acceptable until key rotation schedules diverge |
| Postgres query logs may contain PII | Low | IT Ops | Yes — internal platform, no external log shipping |
| Admin account compromise bypasses rate limit | Medium | IT / Entra | Yes — mitigated by Entra Conditional Access + MFA |
| Graph subscription `clientState` reuse across subscriptions | Low | Dev | Pending review — consider per-subscription HMAC nonce |

---

## Controls not in scope

- Physical security of iPad devices (college policy).
- Microsoft 365 tenant security (Entra, Exchange — managed by IT separately).
- Railway infrastructure hardening.
- DDoS protection at the edge (Railway/Cloudflare handles this).

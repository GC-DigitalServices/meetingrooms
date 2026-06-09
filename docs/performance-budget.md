# Performance budget — MRBS

## Targets

| Metric | Target | Measurement point |
|--------|--------|-------------------|
| POST /api/bookings — p95 | < 1.5 s | `Server-Timing: booking` response header |
| GET / (room grid) — LCP | < 2 s | Lighthouse, 4G throttling, cold cache |
| GET /api/rooms — p95 | < 300 ms | Server-Timing (future) |

---

## Booking write breakdown

The route emits a `Server-Timing` header on every `POST /api/bookings` response:

```
Server-Timing: booking;dur=843;desc="create"
```

`dur` is total service time in milliseconds (excludes network). Visible in:
- **DevTools → Network → Headers → Response Headers → Server-Timing**
- **Lighthouse trace** (appears in the timing waterfall)

Expected budget per phase:

| Phase | Budget | Notes |
|-------|--------|-------|
| Permission + conflict check (Postgres) | < 50 ms | Indexed queries |
| Redis lock acquisition | < 50 ms | In-process, same network |
| Graph event creation | < 800 ms | External API — main variable |
| Postgres booking.create + audit | < 100 ms | Two inserts |
| **Total (p50)** | **~600 ms** | Graph is usually < 400 ms |
| **Total (p95)** | **< 1.5 s** | Worst-case Graph latency |

If `Server-Timing` readings consistently exceed 1 s for the Postgres/Redis phases (excluding Graph), investigate:
1. Missing index on `Booking(roomId, startUtc, endUtc)` — check with `EXPLAIN ANALYZE`.
2. Lock contention — check Redis `MONITOR` for lock key churn.
3. Prisma connection pool exhaustion — check Railway metrics for connection count.

---

## Room grid LCP

LCP is dominated by server-side render time of the room list (Postgres query) and the
initial JS hydration of the socket context.

To measure locally:

```bash
npx lighthouse https://your-railway-url.up.railway.app \
  --only-categories=performance \
  --throttling-method=simulate \
  --screenEmulation.mobile=false \
  --output=json \
  --output-path=./lighthouse-report.json
```

Key metrics to check in the report:
- `largest-contentful-paint` < 2 000 ms
- `total-blocking-time` < 200 ms
- `speed-index` < 3 000 ms

Optimisation levers if LCP > 2 s:
1. Add `export const revalidate = 30` to the rooms page (rooms rarely change intra-day).
2. Ensure the `Room` table query is covered by an index on `active = true`.
3. Check that `next/font` is used for the Greenhead brand font (eliminates FOUT-caused LCP shift).

---

## Ongoing measurement

Railway provides built-in request latency percentiles. Check `Metrics → HTTP Latency` in
the Railway dashboard. Set an alert if p95 crosses 2 s on the `/api/bookings` path.

No Lighthouse CI step runs on every PR (requires a deployed preview URL). Run Lighthouse
manually against the Railway preview deployment before merging significant UI changes.

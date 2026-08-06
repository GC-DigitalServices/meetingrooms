-- Enforce one cache row per Exchange booking (iCalUId). The webhook create path
-- previously did check-then-insert with no DB constraint, so concurrent
-- notifications for one composite booking could insert duplicate rows.

-- 1. De-duplicate any existing rows sharing an iCalUId before adding the
--    constraint (otherwise the unique index would fail to build). Keep the most
--    recently synced row, with id as a deterministic tie-breaker.
DELETE FROM "Booking" a
USING "Booking" b
WHERE a."graphICalUid" = b."graphICalUid"
  AND (a."lastSyncedAt" < b."lastSyncedAt"
       OR (a."lastSyncedAt" = b."lastSyncedAt" AND a."id" < b."id"));

-- 2. Replace the non-unique index with a unique one.
DROP INDEX IF EXISTS "Booking_graphICalUid_idx";
CREATE UNIQUE INDEX "Booking_graphICalUid_key" ON "Booking"("graphICalUid");

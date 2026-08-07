-- Track when a Booking cache row was first written (existing rows backfill to now).
ALTER TABLE "Booking" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Reject inverted / zero-length bookings. NOT VALID enforces the constraint on
-- new and updated rows without scanning existing data, so the deploy migration
-- cannot fail on any legacy row.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_endUtc_after_startUtc" CHECK ("endUtc" > "startUtc") NOT VALID;

-- One device per token hash: data integrity + an index for the per-request
-- device-auth lookup (previously an unindexed scan).
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

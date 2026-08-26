-- Bookings mirrored from a room mailbox that this app did not write. Until now
-- every synced event was stamped PORTAL, so there was no way to ask "which
-- bookings did we not create" — which is what spotting bad Salamander data
-- (and the double-booking gap in invariant 2) needs.
--
-- Additive only: existing rows keep PORTAL. Rows already mirrored from Exchange
-- stay mislabelled until the next full resync updates them.
ALTER TYPE "BookingSource" ADD VALUE 'EXCHANGE';

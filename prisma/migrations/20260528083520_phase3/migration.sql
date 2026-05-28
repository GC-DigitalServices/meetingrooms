-- AlterEnum
ALTER TYPE "RoomKind" ADD VALUE 'MINIBUS';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "premisesNotes" TEXT,
ADD COLUMN     "premisesNotifyHash" TEXT,
ADD COLUMN     "primaryMailboxUpn" TEXT;

-- CreateIndex
CREATE INDEX "Booking_organiserUpn_idx" ON "Booking"("organiserUpn");

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "recurringGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_recurringGroupId_idx" ON "Booking"("recurringGroupId");

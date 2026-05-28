-- CreateEnum
CREATE TYPE "RoomKind" AS ENUM ('STANDARD', 'COMPOSITE', 'SECTION');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PORTAL', 'IPAD_QR');

-- CreateEnum
CREATE TYPE "DeviceScope" AS ENUM ('STANDARD', 'SECTION', 'COMPOSITE');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "mailboxUpn" TEXT,
    "displayName" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "capacity" INTEGER NOT NULL,
    "equipment" TEXT[],
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "kind" "RoomKind" NOT NULL DEFAULT 'STANDARD',
    "parentRoomId" TEXT,
    "allowedGroups" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "graphEventId" TEXT NOT NULL,
    "graphICalUid" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "organiserUpn" TEXT NOT NULL,
    "organiserName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "startUtc" TIMESTAMP(3) NOT NULL,
    "endUtc" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "source" "BookingSource" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "scope" "DeviceScope" NOT NULL,
    "pairingCode" TEXT,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "upn" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "groupIds" TEXT[],
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("upn")
);

-- CreateTable
CREATE TABLE "GraphSubscription" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "clientState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_mailboxUpn_key" ON "Room"("mailboxUpn");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_graphEventId_key" ON "Booking"("graphEventId");

-- CreateIndex
CREATE INDEX "Booking_roomId_startUtc_endUtc_idx" ON "Booking"("roomId", "startUtc", "endUtc");

-- CreateIndex
CREATE INDEX "Booking_graphICalUid_idx" ON "Booking"("graphICalUid");

-- CreateIndex
CREATE INDEX "Device_roomId_idx" ON "Device"("roomId");

-- CreateIndex
CREATE INDEX "GraphSubscription_roomId_idx" ON "GraphSubscription"("roomId");

-- CreateIndex
CREATE INDEX "GraphSubscription_expiresAt_idx" ON "GraphSubscription"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_actor_at_idx" ON "AuditLog"("actor", "at");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_parentRoomId_fkey" FOREIGN KEY ("parentRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

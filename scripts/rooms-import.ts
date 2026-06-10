/**
 * Seed / sync the Room table from config/rooms.yaml.
 *
 * Usage: pnpm rooms:import
 *
 * Safe to re-run: uses upsert so existing rooms are updated in-place.
 * IDs are stable — never change a room's id after its first import.
 */

import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv();

import { db } from "@/lib/db/client";
import { loadRooms } from "@/lib/config/rooms-loader";

async function main() {
  const { rooms } = loadRooms();
  let count = 0;

  for (const room of rooms) {
    if (room.kind === "composite") {
      await db.room.upsert({
        where: { id: room.id },
        create: {
          id: room.id,
          mailboxUpn: null,
          displayName: room.displayName,
          building: room.building ?? null,
          floor: room.floor ?? null,
          capacity: room.capacity,
          equipment: room.equipment,
          bookable: room.bookable ?? true,
          allowedGroups: room.allowedGroups,
          kind: "COMPOSITE",
        },
        update: {
          displayName: room.displayName,
          building: room.building ?? null,
          floor: room.floor ?? null,
          capacity: room.capacity,
          equipment: room.equipment,
          bookable: room.bookable ?? true,
          allowedGroups: room.allowedGroups,
        },
      });
      count++;

      for (const section of room.sections) {
        await db.room.upsert({
          where: { id: section.id },
          create: {
            id: section.id,
            mailboxUpn: section.mailboxUpn,
            displayName: section.displayName,
            building: section.building ?? room.building ?? null,
            floor: section.floor ?? room.floor ?? null,
            capacity: section.capacity,
            equipment: section.equipment,
            bookable: true,
            allowedGroups: section.allowedGroups,
            kind: "SECTION",
            parentRoomId: room.id,
          },
          update: {
            mailboxUpn: section.mailboxUpn,
            displayName: section.displayName,
            building: section.building ?? room.building ?? null,
            floor: section.floor ?? room.floor ?? null,
            capacity: section.capacity,
            equipment: section.equipment,
            allowedGroups: section.allowedGroups,
          },
        });
        count++;
      }
    } else {
      const kind = room.kind === "minibus" ? "MINIBUS" : "STANDARD";
      await db.room.upsert({
        where: { id: room.id },
        create: {
          id: room.id,
          mailboxUpn: room.mailboxUpn,
          displayName: room.displayName,
          building: room.building ?? null,
          floor: room.floor ?? null,
          capacity: room.capacity,
          equipment: room.equipment,
          bookable: room.bookable ?? true,
          allowedGroups: room.allowedGroups,
          kind,
        },
        update: {
          mailboxUpn: room.mailboxUpn,
          displayName: room.displayName,
          building: room.building ?? null,
          floor: room.floor ?? null,
          capacity: room.capacity,
          equipment: room.equipment,
          bookable: room.bookable ?? true,
          allowedGroups: room.allowedGroups,
        },
      });
      count++;
    }
  }

  console.log(`rooms:import: ${count} rooms upserted`);
  await db.$disconnect();
}

main().catch((err: unknown) => {
  console.error("rooms:import failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

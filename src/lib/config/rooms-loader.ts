import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema mirrors config/rooms.yaml.
// Sections only appear nested inside composite rooms.
// ---------------------------------------------------------------------------

const SectionSchema = z.object({
  id: z.string().min(1),
  mailboxUpn: z.string().email("Section mailboxUpn must be a valid email"),
  displayName: z.string().min(1),
  capacity: z.number().int().positive(),
  equipment: z.array(z.string()).default([]),
  allowedGroups: z.array(z.string().uuid()).default([]),
  building: z.string().optional(),
  floor: z.string().optional(),
});

const StandardRoomSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("standard").optional(),
  mailboxUpn: z.string().email("Standard room mailboxUpn must be a valid email"),
  displayName: z.string().min(1),
  building: z.string().optional(),
  floor: z.string().optional(),
  capacity: z.number().int().positive(),
  equipment: z.array(z.string()).default([]),
  bookable: z.boolean().default(true),
  allowedGroups: z.array(z.string().uuid()).default([]),
});

const CompositeRoomSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("composite"),
  mailboxUpn: z.undefined().optional(),
  displayName: z.string().min(1),
  building: z.string().optional(),
  floor: z.string().optional(),
  capacity: z.number().int().positive(),
  equipment: z.array(z.string()).default([]),
  bookable: z.boolean().default(true),
  allowedGroups: z.array(z.string().uuid()).default([]),
  sections: z.array(SectionSchema).min(2, "Composite rooms must have at least 2 sections"),
});

const MinibusRoomSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("minibus"),
  mailboxUpn: z.string().email("Minibus mailboxUpn must be a valid email"),
  displayName: z.string().min(1),
  building: z.string().optional(),
  floor: z.string().optional(),
  capacity: z.number().int().positive(),
  equipment: z.array(z.string()).default([]),
  bookable: z.boolean().default(true),
  allowedGroups: z.array(z.string().uuid()).default([]),
});

const RoomEntrySchema = z.union([CompositeRoomSchema, MinibusRoomSchema, StandardRoomSchema]);

const RoomsFileSchema = z.object({
  rooms: z.array(RoomEntrySchema).min(1),
});

export type SectionConfig = z.infer<typeof SectionSchema>;
export type StandardRoomConfig = z.infer<typeof StandardRoomSchema>;
export type CompositeRoomConfig = z.infer<typeof CompositeRoomSchema>;
export type MinibusRoomConfig = z.infer<typeof MinibusRoomSchema>;
export type RoomConfig = z.infer<typeof RoomEntrySchema>;
export type RoomsFile = z.infer<typeof RoomsFileSchema>;

let _rooms: RoomsFile | undefined;

export function loadRooms(filePath?: string): RoomsFile {
  if (_rooms) return _rooms;

  const resolved = filePath ?? path.join(process.cwd(), "config", "rooms.yaml");
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = parse(raw) as unknown;

  const result = RoomsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config/rooms.yaml:\n${issues}`);
  }

  _rooms = result.data;
  return _rooms;
}

import { db } from "@/lib/db/client";

// Stable key for the minibus safety-check checklist attached to booking
// confirmation emails. Managed via Admin → Minibus checklist.
export const MINIBUS_CHECKLIST_KEY = "minibus-checklist";

export interface ManagedFileMeta {
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
}

/** Returns the stored file (including bytes) for a key, or null if none. */
export async function getManagedFile(key: string) {
  return db.managedFile.findUnique({ where: { key } });
}

/** Returns just the metadata for a key (no bytes), or null if none. */
export async function getManagedFileMeta(key: string): Promise<ManagedFileMeta | null> {
  return db.managedFile.findUnique({
    where: { key },
    select: { filename: true, contentType: true, size: true, uploadedBy: true, uploadedAt: true },
  });
}

/** Inserts or replaces the file stored under a key. */
export async function putManagedFile(input: {
  key: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
  uploadedBy: string;
}): Promise<ManagedFileMeta> {
  const { key, filename, contentType, uploadedBy } = input;
  // Copy into a plain ArrayBuffer-backed Uint8Array — Prisma's Bytes type does
  // not accept Node's Buffer<ArrayBufferLike> under strict TS.
  const data = new Uint8Array(input.data);
  const size = data.length;
  return db.managedFile.upsert({
    where: { key },
    create: { key, filename, contentType, data, size, uploadedBy },
    update: { filename, contentType, data, size, uploadedBy, uploadedAt: new Date() },
    select: { filename: true, contentType: true, size: true, uploadedBy: true, uploadedAt: true },
  });
}

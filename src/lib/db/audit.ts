import { db } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";

export interface AuditEntry {
  actor: string;
  action: string;
  targetId?: string;
  metadata: Prisma.InputJsonValue;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actor:    entry.actor,
      action:   entry.action,
      targetId: entry.targetId,
      metadata: entry.metadata,
    },
  });
}

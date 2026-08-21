import "server-only";
import { prisma } from "@/lib/db";

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        detail: JSON.stringify(input.detail ?? {}),
      },
    });
  } catch (err) {
    // Audit must not break the primary write path.
    console.error("audit write failed", err);
  }
}

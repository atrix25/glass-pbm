import { prisma } from "@/lib/db";

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * Shared audit writer for Next.js request handlers and Node batch workers.
 * The durable approval and execution receipt remain authoritative if this
 * secondary observability write is unavailable.
 */
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
  } catch (error) {
    console.error("audit write failed", error);
  }
}

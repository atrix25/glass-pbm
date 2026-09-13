import type { z } from "zod";
import type { Prisma } from "@/generated/prisma";

export const CONSEQUENCE_CLASSES = [
  "care",
  "coverage",
  "money",
  "contract",
  "external_communication",
  "phi_disclosure",
  "credentialing",
  "legal_compliance",
  "security",
] as const;

export type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];

export type ActionContext = {
  proposal: {
    id: string;
    runId: string;
    agentId: string;
    subjectType: string;
    subjectId: string;
    action: string;
    headline: string;
    rationale: string;
  };
  reviewer: { label: string; role: string };
  now: Date;
};

// `any` is intentionally confined to the erased registry boundary. The value
// is parsed by the paired Zod schema before `execute` is called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionDefinition<T extends z.ZodType = z.ZodType<any>> = {
  action: string;
  description: string;
  schema: T;
  consequences: readonly ConsequenceClass[];
  humanRequired: boolean;
  approverRoles: readonly string[];
  execute: (
    tx: Prisma.TransactionClient,
    payload: z.output<T>,
    context: ActionContext,
  ) => Promise<Record<string, unknown>>;
};


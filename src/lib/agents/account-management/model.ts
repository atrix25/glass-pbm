import { z } from "zod";
export const GoalsSchema = z
  .object({
    savingCents: z.number().int().min(1).max(1e12),
    maxAffectedMembers: z.number().int().min(0).max(1e7),
    maxMembersPayingMore: z.number().int().min(0).max(1e7),
    maxNewRejects: z.number().int().min(0).max(1e7),
  })
  .strict();
export type Goals = z.infer<typeof GoalsSchema>;
export const PatchSchema = z
  .object({
    drugId: z.string().min(1),
    requiresPA: z.boolean().optional(),
    requiresStep: z.boolean().optional(),
    level: z.enum(["1", "2", "3", "4", "$0"]).optional(),
  })
  .strict();
export const BenefitSchema = z
  .object({ formulary: z.array(PatchSchema).max(200) })
  .strict();
export type Benefit = z.infer<typeof BenefitSchema>;
export interface Option {
  id: string;
  name: string;
  override: Benefit;
  planSavingCents: number;
  memberShiftCents: number;
  netSavingCents: number;
  affectedMembers: number;
  membersPayingMore: number;
  newRejects: number;
  claimsEvaluated: number;
  reasons: string[];
}
export function evaluate(option: Option, goals: Goals): Option {
  const reasons: string[] = [];
  if (option.planSavingCents < goals.savingCents)
    reasons.push("Savings goal not met");
  if (option.netSavingCents <= 0) reasons.push("No net system saving");
  if (option.affectedMembers > goals.maxAffectedMembers)
    reasons.push("Member impact limit exceeded");
  if (option.membersPayingMore > goals.maxMembersPayingMore)
    reasons.push("Out-of-pocket limit exceeded");
  if (option.newRejects > goals.maxNewRejects)
    reasons.push("New rejection limit exceeded");
  return { ...option, reasons };
}
export function rank(options: Option[], goals: Goals) {
  return options
    .map((o) => evaluate(o, goals))
    .sort(
      (a, b) =>
        Number(a.reasons.length > 0) - Number(b.reasons.length > 0) ||
        a.affectedMembers - b.affectedMembers ||
        a.membersPayingMore - b.membersPayingMore ||
        a.newRejects - b.newRejects ||
        b.netSavingCents - a.netSavingCents ||
        a.id.localeCompare(b.id),
    );
}
export function patchEntry<
  T extends {
    drugId?: string;
    level: string;
    requiresPA?: boolean;
    requiresStep?: boolean;
  },
>(entry: T, drugId: string, benefit: Benefit): T {
  const patch = benefit.formulary.find((p) => p.drugId === drugId);
  return patch ? { ...entry, ...patch } : entry;
}
export function mergeBenefit(
  base: Benefit,
  patch: z.infer<typeof PatchSchema>,
): Benefit {
  const prior = base.formulary.find((p) => p.drugId === patch.drugId);
  return {
    formulary: [
      ...base.formulary.filter((p) => p.drugId !== patch.drugId),
      { ...prior, ...patch },
    ],
  };
}

import { SectionTitle } from "@/components/ui";
import {
  ChangeConsole,
  type BaselineConfig,
} from "@/components/change-console";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ChangesPage() {
  const plan = await prisma.benefitPlan.findUnique({
    where: { id: "wi-iyc-2026" },
    include: { costShareRules: { where: { channel: "Retail" } } },
  });
  if (!plan) throw new Error("Benefit plan wi-iyc-2026 not found");

  const rule = (level: string) =>
    plan.costShareRules.find((r) => r.level === level);

  const contract = await prisma.contract.findUnique({
    where: { id: "etg0013" },
    include: { rates: { where: { rateSide: "Pharmacy" }, take: 1 } },
  });

  const baseline: BaselineConfig = {
    level1CopayCents: rule("1")?.copayCents ?? 500,
    level2RateBps: rule("2")?.coinsuranceRateBps ?? 2000,
    level2MaxCents: rule("2")?.coinsuranceMaxCents ?? 5000,
    level3RateBps: rule("3")?.coinsuranceRateBps ?? 4000,
    level3MaxCents: rule("3")?.coinsuranceMaxCents ?? 15000,
    level3CountsToRxOop: rule("3")?.accumulatesToRxOop ?? false,
    level4CopayCents: rule("4")?.copayCents ?? 5000,
    level4CountsToRxOop: rule("4")?.accumulatesToRxOop ?? false,
    rxOopLimitCents: plan.rxOopLimitIndividual,
    dawPenaltyEnabled: plan.dawPenaltyEnabled,
    specialtyChannelRestricted: plan.specialtyChannelRestricted,
    includeUandC: contract?.rates[0]?.includeUandC ?? true,
    refillThreshold: 0.75,
  };

  const runs = await prisma.readjudicationRun.findMany({
    include: { configVersion: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const history = runs.map((r) => ({
    id: r.id,
    label: r.configVersion.label,
    createdAt: r.createdAt.toISOString(),
    changeSummary: JSON.parse(r.configVersion.changeSummary) as string[],
    planCostDeltaCents: r.planCostDeltaCents,
    memberCostDeltaCents: r.memberCostDeltaCents,
    claimsChanged: r.claimsChanged,
  }));

  return (
    <div className="space-y-5">
      <SectionTitle description="Change the benefit and see the consequence before it is real. Every stored claim is re-adjudicated against the proposed configuration, in date order, with each member's accumulators rebuilt from scratch. Nothing here is an estimate or a trend factor.">
        Change console
      </SectionTitle>

      <ChangeConsole baseline={baseline} history={history} />
    </div>
  );
}

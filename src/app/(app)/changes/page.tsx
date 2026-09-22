import { Suspense } from "react";
import { SectionTitle } from "@/components/ui";
import {
  ChangeConsole,
  type BaselineConfig,
  type ConsoleRecommendation,
} from "@/components/change-console";
import { prisma } from "@/lib/db";
import { resolveClock } from "@/lib/clock";
import { getRecommendations, type Lever } from "@/lib/nps/recommendations";

export const dynamic = "force-dynamic";

/**
 * A recommendation's edit, as a patch to the console's form.
 *
 * The translation lives here rather than in either module so that the library
 * stays free of UI types and the client component stays free of database
 * concerns, and so that adding a lever fails to compile in one obvious place.
 */
function patchFor(lever: Lever): ConsoleRecommendation["patch"] {
  switch (lever.kind) {
    case "removePA":
      return { paRemovedFor: lever.match };
    case "removeQuantityLimit":
      return { quantityLimitRemovedFor: lever.match };
    case "removeStepTherapy":
      return { stepTherapyRemovedFor: lever.match };
    case "level3CountsToRxOop":
      return { level3CountsToRxOop: true };
    case "level1Copay":
      return { level1CopayCents: lever.cents };
    case "refillThreshold":
      return { refillThreshold: lever.value };
  }
}

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

  /*
   * Six, where the member-experience page lists all of them.
   *
   * The full set runs to eleven, and eleven tiles above the levers turns the
   * console into a menu of somebody else's ideas rather than a place to model
   * your own. The rest are a click away on the page that explains where they
   * came from.
   */
  const recommendations: ConsoleRecommendation[] = (
    await getRecommendations(resolveClock(null))
  ).slice(0, 6).map((r) => ({
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    membersAffected: r.membersAffected,
    caution: r.caution,
    patch: patchFor(r.lever),
  }));

  return (
    <div className="space-y-5">
      <SectionTitle description={"Preview benefit changes before committing. Full runs replay the book; projections use a labeled sample."}>
        Change console
      </SectionTitle>

      {/* useSearchParams needs a boundary, and a console this heavy should not
          block on the query string being read. */}
      <Suspense fallback={null}>
        <ChangeConsole
          baseline={baseline}
          history={history}
          recommendations={recommendations}
        />
      </Suspense>
    </div>
  );
}

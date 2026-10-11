import Link from "next/link";
import { tenantSponsorId,tenantContractId,demoFeaturesEnabled } from "@/lib/config";
import type {SavingsResult} from "@/lib/savings/types";
import { getClock } from "@/lib/session";
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

export default async function ChangesPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params=await searchParams;
  const clock=await getClock();
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
    (params.recommend || params.recommendations === "1") ? await getRecommendations(clock) : []
  ).slice(0, 6).map((r) => ({
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    membersAffected: r.membersAffected,
    caution: r.caution,
    patch: patchFor(r.lever),
  }));

  let imported: ConsoleRecommendation | null = null;
  if (demoFeaturesEnabled() && params.savings?.startsWith('sav_')) {
    const job=await prisma.job.findUnique({where:{id:params.savings}});
    if(job?.type==='savings-v1' && job.status==='succeeded' && job.result) {
      const payload=JSON.parse(job.payload);
      if(payload.sponsor===tenantSponsorId() && payload.contract===tenantContractId()) {
        const result=JSON.parse(job.result) as SavingsResult;
        const option=result.options.find(o=>o.id===params.option);
        if(option) imported={id:'savings',title:option.title,rationale:option.description,membersAffected:option.disruptions.length,caution:`Saved 1% sample through ${result.cutoff.slice(0,10)}. Re-run the full book at the selected clock before any decision. Negotiated pricing requires contracting review.`,patch:{...option.patch,savingsOverride:option.override} as ConsoleRecommendation['patch']};
      }
    }
  }
  return (
    <div className="space-y-5">
      <SectionTitle description="Change the benefit and see the consequence before it is real. Every stored claim is re-adjudicated against the proposed configuration, in date order, with each member's accumulators rebuilt from scratch. Projections run the same engine over a sample and say so; a measured run is the whole book, with no trend factor anywhere.">
        Change console
      </SectionTitle>

      <div className="flex flex-wrap gap-4 text-sm"><Link href="/savings" className="font-medium text-glass-700">Find savings →</Link><Link href="/changes?recommendations=1" className="text-ink-500 underline">Load experience suggestions</Link></div>
      {imported && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><strong>{imported.title}</strong><p className="mt-2">{imported.rationale}</p><p className="mt-2 text-ink-600">{imported.caution}</p><details className="mt-3"><summary className="cursor-pointer">Exact proposed configuration</summary><pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(imported.patch.savingsOverride,null,2)}</pre></details></div>}
      {/* useSearchParams needs a boundary, and a console this heavy should not
          block on the query string being read. */}
      <Suspense fallback={null}>
        <ChangeConsole
          key={imported?.title ?? "default"}
          initialPatch={imported?.patch}
          baseline={baseline}
          history={history}
          recommendations={recommendations}
        />
      </Suspense>
    </div>
  );
}

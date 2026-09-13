import { resolveClock, PLAN_YEAR } from "@/lib/clock";
import {
  getScorecard,
  getSettlementPlan,
} from "@/lib/queries/reconciliation";
import { getExistingGuaranteeCredit } from "@/lib/queries/agent-work";
import { startRun, type Run } from "../runtime";

export interface GuaranteeCreditResult {
  runId: string;
  guaranteeId: string;
  period: string;
  amountCents: number;
  proposed: boolean;
}

export async function runGuaranteeCredit(opts: {
  guaranteeId: string;
  month: number;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: GuaranteeCreditResult }> {
  const at = opts.at ?? new Date();
  const clock = resolveClock(at.toISOString());
  const period = `${PLAN_YEAR}-${String(opts.month + 1).padStart(2, "0")}`;
  const run = await startRun({
    agentId: "guarantee-credit",
    goal: `Post the contract-calculated ${period} credit for guarantee ${opts.guaranteeId}, if one is owed.`,
    subject: {
      type: "PerformanceGuarantee",
      id: `${opts.guaranteeId}:${period}`,
    },
    at,
  });

  const scorecard = await run.tool(
    "getScorecard",
    "The scorecard owns both the measurement and the penalty-band arithmetic; the agent must not calculate a credit.",
    () => getScorecard(clock),
    (value) =>
      `${value.closedMonths} closed months produced ${value.totalCreditCents} cents in exact contract credits.`,
  );
  const settlement = await run.tool(
    "getSettlementPlan",
    "Confirm the scorecard credit against the deterministic settlement calendar and fee ledger before proposing money movement.",
    () => getSettlementPlan(clock, scorecard.totalCreditCents),
    (value) =>
      `${value.creditCents} cents are scheduled through the reconciliation plan.`,
  );
  const existing = await run.tool(
    "getExistingGuaranteeCredit",
    "A guarantee and measurement period may be credited once, whether it is already posted or waiting for approval.",
    () => getExistingGuaranteeCredit(opts.guaranteeId, period),
    (value) =>
      value.posted || value.pendingProposal
        ? "A posted credit or governed proposal already exists."
        : "No prior credit or proposal exists for this period.",
  );

  const row = scorecard.rows.find(
    (candidate) => candidate.guarantee.id === opts.guaranteeId,
  );
  const measured = row?.periods.find(
    (candidate) => candidate.month === opts.month,
  );
  let proposed = false;

  if (!row || !measured) {
    run.refuse(
      "The requested guarantee period is not a closed, measured period.",
      "Only a scorecard period with an authoritative sample can produce a credit.",
    );
  } else if (measured.met || measured.creditCents <= 0) {
    run.refuse(
      `${row.guarantee.name} met its ${period} target.`,
      "The contract penalty function returned no credit, so there is no money action to propose.",
    );
  } else if (existing.posted || existing.pendingProposal) {
    run.refuse(
      `The ${period} credit for ${row.guarantee.name} is already accounted for.`,
      "Duplicate credits are blocked by guarantee and period before a proposal is written.",
    );
  } else {
    const rationale = `${row.guarantee.name} measured ${measured.measured.toFixed(2)}% across ${measured.sample} cases against a ${row.guarantee.target}% target. The contract's ${measured.band} penalty band returned exactly ${measured.creditCents} cents for ${period}; the settlement plan reports ${settlement.creditCents} cents owed year to date.`;
    run.evidence(
      `${row.guarantee.name} missed by ${measured.shortfall.toFixed(2)} points`,
      "Sample, hits, measured result, band, and credit are copied from getScorecard; no model or agent arithmetic sets the money amount.",
      {
        guaranteeId: row.guarantee.id,
        period,
        sample: measured.sample,
        hits: measured.hits,
        measured: measured.measured,
        target: row.guarantee.target,
        shortfall: measured.shortfall,
        band: measured.band,
        creditCents: measured.creditCents,
        yearToDateCreditCents: settlement.creditCents,
      },
    );
    run.propose({
      subjectType: "PerformanceGuarantee",
      subjectId: `${row.guarantee.id}:${period}`,
      action: "post-guarantee-credit",
      headline: `Post ${measured.creditCents} cent ${period} credit for ${row.guarantee.name}`,
      rationale,
      payload: {
        guaranteeId: row.guarantee.id,
        period,
        amountCents: measured.creditCents,
        sponsorInvoiceId: null,
        rationale,
      },
      confidence: 1,
    });
    proposed = true;
  }

  const result: GuaranteeCreditResult = {
    runId: run.id,
    guaranteeId: opts.guaranteeId,
    period,
    amountCents: measured?.creditCents ?? 0,
    proposed,
  };
  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      proposed
        ? `${period} credit of ${measured?.creditCents} cents is held for sponsor approval.`
        : "No new guarantee credit was warranted.",
    );
  }
  return { run, result };
}

/**
 * Runs every agent over the book and records what each one did.
 *
 * This is not a simulation of agent activity. Each run below is the real agent
 * calling its real tools against the real database, and the rows it writes are
 * the rows the operations page reads. The only thing the script decides is
 * which work to hand it.
 *
 * Usage:
 *   tsx scripts/run-agents.ts            all agents
 *   tsx scripts/run-agents.ts pa-intake  one agent
 */

import { prisma } from "../src/lib/db.js";
import { seedPolicies } from "./agents/policies.js";
import { resolveClock, PLAN_YEAR } from "../src/lib/clock.js";
import {
  listRebateCollectionWork,
  listServiceEscalationWork,
} from "../src/lib/queries/agent-work.js";

const only = process.argv[2];
const wanted = (id: string) => !only || only === id;

function progress(done: number, total: number, label: string) {
  if (done % 200 === 0 || done === total) {
    process.stdout.write(
      `  ${label}: ${done}/${total} (${Math.round((done / total) * 100)}%)\n`,
    );
  }
}

async function paIntake() {
  const { runIntake } = await import("../src/lib/agents/pa-intake/agent.js");
  const notes = await prisma.clinicalNote.findMany({
    select: { paId: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`pa-intake: ${notes.length} requests with a chart note.`);

  let escalated = 0;
  let fields = 0;
  let correct = 0;
  for (const [i, n] of notes.entries()) {
    const { result } = await runIntake({ paId: n.paId });
    if (result.outcome === "Escalated") escalated++;
    if (result.accuracy) {
      fields += result.accuracy.fields;
      correct += result.accuracy.correct;
    }
    progress(i + 1, notes.length, "pa-intake");
  }
  console.log(
    `  ${escalated} escalated (${((escalated / notes.length) * 100).toFixed(1)}%), extraction ${((correct / fields) * 100).toFixed(1)}% of ${fields} fields.`,
  );
}

async function planDesign() {
  const { runPlanDesign } = await import(
    "../src/lib/agents/plan-design/agent.js"
  );
  // One run a quarter, each seeing only the book as it stood on that day.
  const dates = [
    new Date(Date.UTC(PLAN_YEAR, 4, 15)),
    new Date(Date.UTC(PLAN_YEAR, 7, 14)),
    new Date(Date.UTC(PLAN_YEAR, 10, 13)),
  ];
  for (const at of dates) {
    const clock = resolveClock(at.toISOString());
    process.stdout.write(`  plan-design: quarter ending ${at.toISOString().slice(0, 10)}\n`);
    const out = await runPlanDesign({
      clock,
      onProgress: (n) => process.stdout.write(`    ${n}\n`),
    });
    if (out) {
      console.log(`    ${out.result.recommendation?.name ?? "no option recommended"}`);
    } else {
      console.log("    no actionable driver");
    }
  }
}

async function integrityTriage() {
  const { runTriage } = await import("../src/lib/agents/integrity/agent.js");
  const signals = await prisma.integritySignal.findMany({
    select: { id: true },
    orderBy: { score: "desc" },
  });
  console.log(`integrity-triage: ${signals.length} scored signals.`);
  for (const [i, s] of signals.entries()) {
    await runTriage({ signalId: s.id });
    progress(i + 1, signals.length, "integrity-triage");
  }
}

async function eligibilityResolver() {
  const { runResolver } = await import(
    "../src/lib/agents/eligibility/agent.js"
  );
  const rejects = await prisma.eligibilityTransaction.findMany({
    where: { status: "Rejected" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  console.log(`eligibility-resolver: ${rejects.length} rejected transactions.`);
  for (const [i, r] of rejects.entries()) {
    await runResolver({ transactionId: r.id });
    progress(i + 1, rejects.length, "eligibility-resolver");
  }
}

async function appealDrafter() {
  const { runAppealDraft } = await import("../src/lib/agents/appeals/agent.js");
  const appeals = await prisma.macAppeal.findMany({
    select: { id: true },
    orderBy: { submittedAt: "asc" },
  });
  console.log(`appeal-drafter: ${appeals.length} appeals.`);
  for (const [i, a] of appeals.entries()) {
    await runAppealDraft({ appealId: a.id });
    progress(i + 1, appeals.length, "appeal-drafter");
  }
}

/**
 * The busiest agent, and the only one a member ever meets. Questions are drawn
 * from what members with these drugs and these accumulators would actually
 * ring about, rather than from a list of questions the agent happens to answer
 * well: a good share of them are the clinical ones it is required to refuse.
 */
async function memberService() {
  const { answerMember } = await import(
    "../src/lib/agents/member-service/agent.js"
  );
  const { Rng } = await import("./seed/population.js");

  // Members who have something to ask about: a specialty fill, a rejection, a
  // deductible they are partway through.
  const withFills = await prisma.$queryRaw<
    { memberId: string; drugName: string; filledAt: number }[]
  >`
    SELECT c.memberId, d.name AS drugName,
           CAST(MAX(c.dateOfService) AS REAL) AS filledAt
    FROM Claim c
    JOIN Drug d ON d.id = c.drugId
    WHERE c.responseStatus IN ('P','R')
    GROUP BY c.memberId
    ORDER BY c.memberId
    LIMIT 900
  `;
  if (withFills.length === 0) {
    console.log("member-service: no claims to ask about.");
    return;
  }

  const templates: ((d: string) => string)[] = [
    (d) => `is ${d} covered`,
    (d) => `how much will ${d} cost me`,
    (d) => `why was my ${d} claim rejected`,
    (d) => `where can I fill ${d}`,
    (d) => `do I need prior authorization for ${d}`,
    (d) => `what is the status of my prior authorization for ${d}`,
    () => `how much of my deductible is left`,
    () => `how much have I spent this year`,
    (d) => `can I get a 90 day supply of ${d}`,
    (d) => `is there a cheaper alternative to ${d}`,
    (d) => `is ${d} safe to take with my other medications`,
    (d) => `should I stop taking ${d}`,
    (d) => `what dose of ${d} should I be on`,
  ];

  const rng = new Rng(0xa9e17);
  console.log(`member-service: ${withFills.length} member questions.`);
  let refused = 0;
  let handoffs = 0;
  for (const [i, row] of withFills.entries()) {
    const q = rng.pick(templates)(row.drugName);
    // Members ring about a fill in the days around it, not at a moment of the
    // backfill's choosing. Dating the run to the real work is what lets the
    // run log be cut by month and mean anything.
    const at = new Date(
      Number(row.filledAt) +
        rng.int(-2, 9) * 86_400_000 +
        rng.int(8 * 60, 18 * 60) * 60_000,
    );
    const out = await answerMember({
      question: q,
      memberId: row.memberId,
      at,
      persist: true,
    });
    if (out.handoff === "clinical") refused++;
    if (out.handoffPacket) handoffs++;
    progress(i + 1, withFills.length, "member-service");
  }
  console.log(
    `  ${refused} refused as clinical, ${handoffs} handed to a person with a packet.`,
  );
}

async function review() {
  const { reviewProposals } = await import("./agents/review.js");
  const out = await reviewProposals(prisma);
  console.log(
    `review: ${out.reviewed} proposals seen by a person, ${out.overrides} reversed (${((out.overrides / Math.max(1, out.reviewed)) * 100).toFixed(1)}%).`,
  );
}

/**
 * Sponsor analytics questions that exercise each data-agent intent. Kept short
 * so a full fleet seed finishes in seconds rather than minutes.
 */
async function dataAgent() {
  const { answerDataQuestion } = await import(
    "../src/lib/agents/data-agent/agent.js"
  );
  const questions = [
    "How much has the plan spent year to date?",
    "Which pricing guarantees missed?",
    "Write the year-end rebate briefing",
    "What drove PMPM last period?",
    "Show top drugs by spend",
    "How does our book compare under a traditional spread schedule?",
    "Summarise settlement and rebate receivables",
    "How is the operational scorecard looking?",
    "Write the full year-end report briefing",
  ];
  const at = resolveClock(null).now;
  console.log(`data-agent: ${questions.length} sponsor questions.`);
  let completed = 0;
  for (const [i, question] of questions.entries()) {
    const out = await answerDataQuestion({ question, at, persist: true });
    if (!out.handoff) completed++;
    progress(i + 1, questions.length, "data-agent");
  }
  console.log(`  ${completed}/${questions.length} answered from the ledger.`);
}

async function rebateCollections() {
  const { runRebateCollections } = await import(
    "../src/lib/agents/rebate-collections/agent.js"
  );
  const at = resolveClock(null).now;
  const invoiceIds = await listRebateCollectionWork(at);
  console.log(
    `rebate-collections: ${invoiceIds.length} actionable invoice variances.`,
  );
  let proposed = 0;
  for (const [i, invoiceId] of invoiceIds.entries()) {
    const out = await runRebateCollections({ invoiceId, at });
    if (out.result.proposed) proposed++;
    progress(i + 1, invoiceIds.length, "rebate-collections");
  }
  console.log(`  ${proposed} new disputes proposed from deterministic facts.`);
}

async function guaranteeCredit() {
  const { runGuaranteeCredit } = await import(
    "../src/lib/agents/guarantee-credit/agent.js"
  );
  const { getScorecard } = await import(
    "../src/lib/queries/reconciliation.js"
  );
  const clock = resolveClock(null);
  const scorecard = await getScorecard(clock);
  const missed = scorecard.rows.flatMap((row) =>
    row.periods
      .filter((period) => period.creditCents > 0)
      .map((period) => ({
        guaranteeId: row.guarantee.id,
        month: period.month,
      })),
  );
  console.log(`guarantee-credit: ${missed.length} missed guarantee periods.`);
  let proposed = 0;
  for (const [i, item] of missed.entries()) {
    const out = await runGuaranteeCredit({ ...item, at: clock.now });
    if (out.result.proposed) proposed++;
    progress(i + 1, missed.length, "guarantee-credit");
  }
  console.log(`  ${proposed} exact scorecard credits proposed.`);
}

async function serviceEscalationTriage() {
  const { runServiceEscalationTriage } = await import(
    "../src/lib/agents/service-escalation/agent.js"
  );
  const at = resolveClock(null).now;
  const sources = await listServiceEscalationWork(at);
  console.log(
    `service-escalation-triage: ${sources.length} unresolved sources.`,
  );
  let proposed = 0;
  for (const [i, source] of sources.entries()) {
    const out = await runServiceEscalationTriage({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      at,
    });
    if (out.result.proposed) proposed++;
    progress(i + 1, sources.length, "service-escalation-triage");
  }
  console.log(`  ${proposed} unified service cases proposed.`);
}

async function main() {
  const started = Date.now();

  if (!only) {
    const cleared = await prisma.agentRun.deleteMany();
    console.log(`Cleared ${cleared.count} previous runs.`);
  } else {
    await prisma.agentRun.deleteMany({ where: { agentId: only } });
  }
  // Always refresh policy history so a single-agent run still has a row in
  // force for the new agents (e.g. data-agent) and the invariant suite agrees.
  console.log(`Wrote ${await seedPolicies(prisma)} policy periods.`);

  if (wanted("pa-intake")) await paIntake();
  if (wanted("plan-design")) await planDesign();
  if (wanted("integrity-triage")) await integrityTriage();
  if (wanted("eligibility-resolver")) await eligibilityResolver();
  if (wanted("appeal-drafter")) await appealDrafter();
  if (wanted("member-service")) await memberService();
  if (wanted("data-agent")) await dataAgent();
  if (wanted("rebate-collections")) await rebateCollections();
  if (wanted("guarantee-credit")) await guaranteeCredit();
  if (wanted("service-escalation-triage")) await serviceEscalationTriage();

  // Always last: the reviews are about whatever proposals now exist.
  await review();

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

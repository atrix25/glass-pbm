import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { getHarnessResults } from "./proof";
import { getCurrentReading } from "./nps";

/** Only reached before the first reading has ever been taken. */
async function computeNpsForWalkthrough(clock: SimulationClock) {
  const reading = await getCurrentReading(clock);
  return {
    npsCensus: reading.census.nps,
    npsSurveyed: reading.surveyed.nps,
  };
}

/**
 * The figures the walkthrough quotes at each stop.
 *
 * The point of the walkthrough is to answer a sceptic, and a sceptic is not
 * answered by a page of prose. Every stop therefore carries a number pulled
 * out of the same database the stop is describing, so the tour is itself an
 * instance of the thing it claims: nothing is typed in, and if the book
 * changes the tour changes with it.
 *
 * Everything here is deliberately cheap. Claim aggregates come off the daily
 * rollup rather than off 1.7 million rows, and the exemplar records are looked
 * up rather than hard-coded so a reseed cannot leave the tour pointing at a
 * claim that no longer exists.
 */

export interface Exemplar {
  href: string;
  label: string;
  detail: string;
}

export interface WalkthroughFacts {
  lives: number;
  claims: number;
  claimsPaid: number;
  claimsRejected: number;
  planPaidCents: number;
  memberPaidCents: number;

  eligibilityFiles: number;
  eligibilityRejected: number;

  priorAuths: number;
  priorAuthsByTree: number;
  durAlerts: number;
  integritySignals: number;

  macAppeals: number;
  reversals: number;

  npsCensus: number;
  npsSurveyed: number;

  agentRuns: number;
  agentHeld: number;
  agentRefusals: number;

  testsPassed: number;
  testsFailed: number;
  testsAvailable: boolean;

  claimsPerSecond: number | null;
  sourceDocuments: number;
  pharmacies: number;
  drugs: number;

  /** Records to open, resolved now so the links always land somewhere real. */
  exampleClaim: Exemplar | null;
  examplePa: Exemplar | null;
  exampleAgentRun: Exemplar | null;
  exampleMember: Exemplar | null;
}

export async function getWalkthroughFacts(
  clock: SimulationClock,
): Promise<WalkthroughFacts> {
  const now = clock.now;

  const [
    rollup,
    lives,
    eligibilityFiles,
    eligibilityRejected,
    priorAuths,
    priorAuthsByTree,
    durAlerts,
    integritySignals,
    macAppeals,
    reversals,
    agentRuns,
    agentHeld,
    agentRefusals,
    harness,
    fastestRun,
    sourceDocuments,
    pharmacies,
    drugs,
    exampleClaimRow,
    examplePaRow,
    exampleAgentRunRow,
    exampleMemberRow,
  ] = await Promise.all([
    prisma.bookDay.aggregate({
      where: { date: { lte: now } },
      _sum: {
        claimsSubmitted: true,
        claimsPaid: true,
        claimsRejected: true,
        planPaidCents: true,
        patientPayCents: true,
      },
    }),
    prisma.member.count(),
    prisma.eligibilityFile.count(),
    prisma.eligibilityTransaction.count({ where: { status: "Rejected" } }),
    prisma.priorAuthorization.count({ where: { receivedAt: { lte: now } } }),
    prisma.priorAuthorization.count({
      where: { receivedAt: { lte: now }, treeId: { not: null } },
    }),
    prisma.durAlert.count(),
    prisma.integritySignal.count(),
    prisma.macAppeal.count(),
    // Counted the way the reversals page counts them: a B2 that has arrived,
    // by arrival rather than by the original date of service it books back
    // to. A tour that quotes a different number from the page it sends the
    // reader to has done the opposite of its job.
    prisma.claim.count({
      where: { transactionCode: "B2", adjudicatedAt: { lte: now } },
    }),
    prisma.agentRun.count({ where: { startedAt: { lte: now } } }),
    prisma.agentProposal.count({
      where: { createdAt: { lte: now }, consequential: true },
    }),
    prisma.agentRun.count({
      where: { startedAt: { lte: now }, outcome: "Refused" },
    }),
    getHarnessResults(),
    prisma.throughputRun.findFirst({
      orderBy: { claimsPerSecond: "desc" },
      select: { claimsPerSecond: true },
    }),
    prisma.sourceDocument.count(),
    // Pharmacies under contract, which is not the same as pharmacies on file.
    // One of the nineteen is deliberately outside the network so that an
    // out-of-network reject has somewhere to come from, and a tour that counts
    // it as contracted is off by one against the network page it links to.
    prisma.networkPharmacy
      .findMany({ distinct: ["pharmacyId"], select: { pharmacyId: true } })
      .then((rows) => rows.length),
    prisma.drug.count(),

    // An expensive paid fill with no stored trace, so opening it forces the
    // engine to re-derive the claim and print the recomputation banner. A
    // claim carrying a stored trace would show the same arithmetic without
    // proving anything about where the arithmetic came from, which is the
    // whole point of sending a sceptic to this particular page.
    prisma.claim.findFirst({
      where: {
        responseStatus: "P",
        dateOfService: { lte: now },
        traceJson: null,
      },
      orderBy: { totalBilledCents: "desc" },
      select: {
        id: true,
        claimNumber: true,
        totalBilledCents: true,
        drug: { select: { name: true } },
      },
    }),
    // A request decided by walking a transcribed criteria form, which is the
    // only kind where the deciding step can be checked against the PDF.
    prisma.priorAuthorization.findFirst({
      where: {
        treeId: { not: null },
        determination: { not: null },
        decidedAt: { lte: now },
      },
      orderBy: { decidedAt: "desc" },
      select: {
        id: true,
        paNumber: true,
        determination: true,
        drug: { select: { name: true } },
      },
    }),
    prisma.agentRun.findFirst({
      where: { agentId: "pa-intake", outcome: "Escalated", startedAt: { lte: now } },
      orderBy: { startedAt: "desc" },
      select: { id: true, summary: true },
    }),
    prisma.member.findFirst({
      where: { claims: { some: { responseStatus: "P" } } },
      orderBy: { id: "asc" },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  const sum = rollup._sum;

  /*
   * The member score comes from the most recent recorded reading rather than
   * being computed here. Scoring the book costs a few seconds against 1.7
   * million claims, which is a poor trade on a page whose job is to be read
   * quickly, and the tour is describing what the score is rather than serving
   * as its source of truth. The /experience page computes live.
   */
  const latest = await prisma.npsSnapshot.findFirst({
    orderBy: { takenAt: "desc" },
    select: { npsCensus: true, npsSurveyed: true },
  });
  const nps = latest ?? (await computeNpsForWalkthrough(clock));

  return {
    lives,
    claims: sum.claimsSubmitted ?? 0,
    claimsPaid: sum.claimsPaid ?? 0,
    claimsRejected: sum.claimsRejected ?? 0,
    planPaidCents: sum.planPaidCents ?? 0,
    memberPaidCents: sum.patientPayCents ?? 0,

    eligibilityFiles,
    eligibilityRejected,

    priorAuths,
    priorAuthsByTree,
    durAlerts,
    integritySignals,

    macAppeals,
    reversals,

    npsCensus: nps.npsCensus,
    npsSurveyed: nps.npsSurveyed,

    agentRuns,
    agentHeld,
    agentRefusals,

    testsPassed: harness.passed,
    testsFailed: harness.failed,
    testsAvailable: harness.available,

    claimsPerSecond: fastestRun?.claimsPerSecond ?? null,
    sourceDocuments,
    pharmacies,
    drugs,

    exampleClaim: exampleClaimRow
      ? {
          href: `/claims/${exampleClaimRow.id}`,
          label: exampleClaimRow.claimNumber,
          detail: exampleClaimRow.drug.name,
        }
      : null,
    examplePa: examplePaRow
      ? {
          href: `/pa/${examplePaRow.id}`,
          label: examplePaRow.paNumber,
          detail: `${examplePaRow.drug.name}, ${String(examplePaRow.determination).toLowerCase()}`,
        }
      : null,
    exampleAgentRun: exampleAgentRunRow
      ? {
          href: `/agents/runs/${exampleAgentRunRow.id}`,
          label: "an escalated intake run",
          detail: exampleAgentRunRow.summary,
        }
      : null,
    exampleMember: exampleMemberRow
      ? {
          href: `/members/${exampleMemberRow.id}`,
          label: `${exampleMemberRow.firstName} ${exampleMemberRow.lastName}`,
          detail: "one covered life, every fill and what it cost them",
        }
      : null,
  };
}

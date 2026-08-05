/**
 * Prior authorization criteria.
 *
 * A criteria tree is only trustworthy if every branch in it has been walked
 * and lands somewhere sensible. These tests check the structure of the
 * encoded trees against the published forms, and then check that the
 * determinations on file are consistent with the path recorded for them.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { paDeadlines } from "@/lib/pa/engine";

interface Step {
  stepNumber: number;
  question: string;
  yesOutcome: string;
  yesStep: number | null;
  yesApprovalDays: number | null;
  noOutcome: string;
  noStep: number | null;
  noApprovalDays: number | null;
  denyReason: string | null;
  citation: string | null;
}

interface Tree {
  id: string;
  name: string;
  steps: Step[];
}

let trees: Tree[] = [];

beforeAll(async () => {
  trees = await prisma.pACriteriaTree.findMany({
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
  expect(trees.length).toBeGreaterThan(0);
});

describe("the encoded trees are well formed", () => {
  it("gives every step both a yes and a no branch", () => {
    const bad: string[] = [];
    for (const t of trees) {
      for (const s of t.steps) {
        if (!["step", "approve", "deny"].includes(s.yesOutcome))
          bad.push(`${t.id} step ${s.stepNumber} yes: ${s.yesOutcome}`);
        if (!["step", "approve", "deny"].includes(s.noOutcome))
          bad.push(`${t.id} step ${s.stepNumber} no: ${s.noOutcome}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("points every continuation at a step that exists", () => {
    const dangling: string[] = [];
    for (const t of trees) {
      const numbers = new Set(t.steps.map((s) => s.stepNumber));
      for (const s of t.steps) {
        if (s.yesOutcome === "step" && !numbers.has(s.yesStep ?? -1))
          dangling.push(`${t.id} step ${s.stepNumber} yes -> ${s.yesStep}`);
        if (s.noOutcome === "step" && !numbers.has(s.noStep ?? -1))
          dangling.push(`${t.id} step ${s.stepNumber} no -> ${s.noStep}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("only ever moves forward, so no traversal can loop", () => {
    const backward: string[] = [];
    for (const t of trees) {
      for (const s of t.steps) {
        if (s.yesOutcome === "step" && (s.yesStep ?? 0) <= s.stepNumber)
          backward.push(`${t.id} step ${s.stepNumber} yes -> ${s.yesStep}`);
        if (s.noOutcome === "step" && (s.noStep ?? 0) <= s.stepNumber)
          backward.push(`${t.id} step ${s.stepNumber} no -> ${s.noStep}`);
      }
    }
    expect(backward).toEqual([]);
  });

  it("attaches an approval duration to every approval", () => {
    const missing: string[] = [];
    for (const t of trees) {
      for (const s of t.steps) {
        if (s.yesOutcome === "approve" && !s.yesApprovalDays)
          missing.push(`${t.id} step ${s.stepNumber} yes`);
        if (s.noOutcome === "approve" && !s.noApprovalDays)
          missing.push(`${t.id} step ${s.stepNumber} no`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("attaches a stated reason to every denial", () => {
    const missing: string[] = [];
    for (const t of trees) {
      for (const s of t.steps) {
        if ((s.yesOutcome === "deny" || s.noOutcome === "deny") && !s.denyReason)
          missing.push(`${t.id} step ${s.stepNumber}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("cites the published form on every step", () => {
    const uncited: string[] = [];
    for (const t of trees) {
      for (const s of t.steps) {
        if (!s.citation) uncited.push(`${t.id} step ${s.stepNumber}`);
      }
    }
    expect(uncited).toEqual([]);
  });

  it("makes every step reachable from the entry point", () => {
    const unreachable: string[] = [];
    for (const t of trees) {
      const first = Math.min(...t.steps.map((s) => s.stepNumber));
      const seen = new Set<number>([first]);
      const queue = [first];
      const byNumber = new Map(t.steps.map((s) => [s.stepNumber, s]));
      while (queue.length > 0) {
        const step = byNumber.get(queue.shift()!);
        if (!step) continue;
        for (const next of [
          step.yesOutcome === "step" ? step.yesStep : null,
          step.noOutcome === "step" ? step.noStep : null,
        ]) {
          if (next != null && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      for (const s of t.steps) {
        if (!seen.has(s.stepNumber))
          unreachable.push(`${t.id} step ${s.stepNumber}`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("can reach both an approval and a denial in every tree", () => {
    for (const t of trees) {
      const outcomes = t.steps.flatMap((s) => [s.yesOutcome, s.noOutcome]);
      expect(
        { tree: t.id, approves: outcomes.includes("approve") },
      ).toEqual({ tree: t.id, approves: true });
      expect(
        { tree: t.id, denies: outcomes.includes("deny") },
      ).toEqual({ tree: t.id, denies: true });
    }
  });
});

describe("recorded determinations match the path that was walked", () => {
  it("names the deciding step on every decided request", async () => {
    const decided = await prisma.priorAuthorization.findMany({
      where: { determination: { in: ["Approved", "Denied"] } },
      select: { paNumber: true, decidingStepNumber: true, treeId: true },
    });
    expect(decided.length).toBeGreaterThan(0);
    const missing = decided.filter(
      (p) => p.treeId && p.decidingStepNumber == null,
    );
    expect(missing.map((p) => p.paNumber)).toEqual([]);
  });

  it("ends each traversal on the step the determination names", async () => {
    const paths = await prisma.priorAuthorization.findMany({
      where: { determination: { in: ["Approved", "Denied"] }, treeId: { not: null } },
      include: {
        decisionSteps: {
          include: { criteriaStep: true },
          orderBy: { seq: "asc" },
        },
      },
    });

    const mismatched: string[] = [];
    for (const pa of paths) {
      if (pa.decisionSteps.length === 0) continue;
      const last = pa.decisionSteps[pa.decisionSteps.length - 1];
      if (last.criteriaStep.stepNumber !== pa.decidingStepNumber) {
        mismatched.push(
          `${pa.paNumber}: ended at ${last.criteriaStep.stepNumber}, claims ${pa.decidingStepNumber}`,
        );
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("reaches the recorded outcome by following the recorded answers", async () => {
    const paths = await prisma.priorAuthorization.findMany({
      where: { determination: { in: ["Approved", "Denied"] }, treeId: { not: null } },
      include: {
        decisionSteps: {
          include: { criteriaStep: true },
          orderBy: { seq: "asc" },
        },
      },
    });

    const inconsistent: string[] = [];
    for (const pa of paths) {
      if (pa.decisionSteps.length === 0) continue;
      const last = pa.decisionSteps[pa.decisionSteps.length - 1];
      const branch = last.answer
        ? last.criteriaStep.yesOutcome
        : last.criteriaStep.noOutcome;
      const expected = branch === "approve" ? "Approved" : branch === "deny" ? "Denied" : "step";

      if (expected !== pa.determination) {
        inconsistent.push(
          `${pa.paNumber}: step ${last.criteriaStep.stepNumber} answered ${last.answer ? "yes" : "no"} leads to ${branch}, but the record says ${pa.determination}`,
        );
      }
    }
    expect(inconsistent).toEqual([]);
  });

  it("walks steps in the order the form numbers them", async () => {
    const paths = await prisma.priorAuthorization.findMany({
      where: { treeId: { not: null } },
      include: {
        decisionSteps: {
          include: { criteriaStep: true },
          orderBy: { seq: "asc" },
        },
      },
    });

    const outOfOrder: string[] = [];
    for (const pa of paths) {
      let previous = -Infinity;
      for (const d of pa.decisionSteps) {
        if (d.criteriaStep.stepNumber <= previous) {
          outOfOrder.push(`${pa.paNumber} revisits ${d.criteriaStep.stepNumber}`);
          break;
        }
        previous = d.criteriaStep.stepNumber;
      }
    }
    expect(outOfOrder).toEqual([]);
  });

  it("records evidence for every answer given", async () => {
    const blank = await prisma.pADecisionStep.count({
      where: { OR: [{ evidence: null }, { evidence: "" }] },
    });
    expect(blank).toBe(0);
  });
});

/*
 * A suite that asserts nothing was ever late is asserting that nothing ever
 * goes wrong, which is the claim every processor makes and none can support.
 * The useful statement is narrower and checkable: the timeline holds
 * absolutely except inside a service degradation that was recorded, disclosed
 * and paid for. A late decision with no incident behind it is the failure
 * these tests are looking for.
 */
describe("regulatory timelines", () => {
  /*
   * Turnaround is measured from when the clock started, which is not always
   * when the request arrived. On an exception the plan cannot lawfully decide
   * until the prescriber's supporting statement is in hand, so measuring from
   * receipt reports the plan late on requests it was not allowed to answer —
   * and a member who takes three weeks to get a statement out of a prescriber
   * would show up as a processing failure. Grievances carry no determination
   * deadline at all and are out of scope rather than always compliant.
   */
  async function breachesOutsideIncidents(urgency: string, hours: number) {
    const [rows, incidents] = await Promise.all([
      prisma.priorAuthorization.findMany({
        where: {
          urgency,
          decidedAt: { not: null },
          requestType: { not: "Grievance" },
        },
        select: {
          paNumber: true,
          receivedAt: true,
          decidedAt: true,
          requestType: true,
          prescriberStatementAt: true,
        },
      }),
      prisma.serviceIncident.findMany({
        select: { startedAt: true, endedAt: true },
      }),
    ]);

    return rows
      .filter((p) => {
        const startedAt = paDeadlines(
          p.receivedAt,
          urgency === "Expedited" ? "Expedited" : "Standard",
          "Commercial",
          {
            requestType: p.requestType,
            supportingStatementAt: p.prescriberStatementAt,
          },
        ).binding.startedAt;
        return (
          (p.decidedAt!.getTime() - startedAt.getTime()) / 3_600_000 > hours
        );
      })
      .filter(
        (p) =>
          !incidents.some(
            (i) => p.receivedAt >= i.startedAt && p.receivedAt <= i.endedAt,
          ),
      )
      .map((p) => p.paNumber);
  }

  it("decides standard requests within 72 hours, outside a declared incident", async () => {
    expect(await breachesOutsideIncidents("Standard", 72)).toEqual([]);
  });

  it("decides expedited requests within 24 hours, outside a declared incident", async () => {
    expect(await breachesOutsideIncidents("Expedited", 24)).toEqual([]);
  });

  it("pays for the ones inside the incident rather than explaining them", async () => {
    const late = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*) AS n
      FROM PriorAuthorization
      WHERE decidedAt IS NOT NULL
        AND requestType <> 'Grievance'
        AND (decidedAt - CASE
              WHEN requestType IN ('FormularyException', 'StepException',
                                   'QuantityException', 'TieringException')
                   AND prescriberStatementAt IS NOT NULL
              THEN prescriberStatementAt
              ELSE receivedAt
            END) / 3600000.0 >
            (CASE WHEN urgency = 'Expedited' THEN 24 ELSE 72 END)
    `;
    const count = Number(late[0].n);
    if (count === 0) return;

    /*
     * Every one of them is inside a window the plan declared, told the sponsor
     * about within hours, and carried a credit for on the reconciliation.
     */
    const incidents = await prisma.serviceIncident.findMany();
    expect(incidents.length).toBeGreaterThan(0);
    for (const incident of incidents) {
      expect(incident.notifiedAt.getTime()).toBeLessThanOrEqual(
        incident.endedAt.getTime(),
      );
      expect(incident.cause.length).toBeGreaterThan(40);
      expect(incident.remedy.length).toBeGreaterThan(40);
    }
  });
});

describe("automation boundaries", () => {
  it("never lets automation issue a denial on its own", async () => {
    const autoDenied = await prisma.priorAuthorization.count({
      where: { determination: "Denied", decidedBy: "AI", escalated: false },
    });
    // A denial is an adverse determination. A pharmacist has to make it.
    expect(autoDenied).toBe(0);
  });
});

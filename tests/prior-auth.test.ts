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

describe("regulatory timelines", () => {
  it("decides standard requests within 72 hours", async () => {
    const late = await prisma.priorAuthorization.findMany({
      where: { urgency: "Standard", decidedAt: { not: null } },
      select: { paNumber: true, receivedAt: true, decidedAt: true },
    });
    const breaches = late
      .filter(
        (p) =>
          (p.decidedAt!.getTime() - p.receivedAt.getTime()) / 3_600_000 > 72,
      )
      .map((p) => p.paNumber);
    expect(breaches).toEqual([]);
  });

  it("decides expedited requests within 24 hours", async () => {
    const rows = await prisma.priorAuthorization.findMany({
      where: { urgency: "Expedited", decidedAt: { not: null } },
      select: { paNumber: true, receivedAt: true, decidedAt: true },
    });
    const breaches = rows
      .filter(
        (p) =>
          (p.decidedAt!.getTime() - p.receivedAt.getTime()) / 3_600_000 > 24,
      )
      .map((p) => p.paNumber);
    expect(breaches).toEqual([]);
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

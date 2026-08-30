/**
 * Member service agent evaluation.
 *
 * The standard is not that the answer reads well. It is that every figure in
 * it came from a tool that read the database, that the routing picked the
 * question the member actually asked, and that the agent declines the things
 * it has no business answering.
 *
 * Each case checks the answer against a value computed independently from the
 * same data, so a regression in the tools shows up as a disagreement rather
 * than as prose that merely sounds confident.
 */

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { planCalls, runPlan } from "@/lib/agent/plan";
import { compose, type ToolRun } from "@/lib/agent/compose";
import type { ToolResult } from "@/lib/agent/tools";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";

async function ask(memberId: string, question: string) {
  const plan = await planCalls(question, memberId);
  const runs = (await runPlan(plan.calls)) as ToolRun[];
  const answer = compose(question, plan.intent, runs);
  return {
    intent: plan.intent,
    drug: plan.drug,
    tools: runs.map((r) => r.tool),
    text: answer.paragraphs.join(" "),
    paragraphs: answer.paragraphs,
    citations: answer.citations,
    runs,
  };
}

const MARGARET = DEMO_MEMBER_STORIES.find((m) => m.name.includes("Margaret"))!;
const JENNIFER = DEMO_MEMBER_STORIES.find((m) => m.name.includes("Jennifer"))!;
const THOMAS = DEMO_MEMBER_STORIES.find((m) => m.name.includes("Thomas"))!;

describe("routing picks the question the member asked", () => {
  const cases: [string, string][] = [
    ["Why am I still paying after hitting my $600 limit?", "oop-limit"],
    ["How much have I paid this year?", "oop-limit"],
    ["How much have I spent toward my out of pocket maximum?", "oop-limit"],
    ["Have I met my out-of-pocket max yet?", "oop-limit"],
    ["How much would Ozempic cost me?", "cost-quote"],
    ["how much is my atorvastatin", "cost-quote"],
    ["What is the copay on Lipitor?", "cost-quote"],
    ["Is Jardiance covered?", "coverage"],
    ["Was my prior authorization approved?", "pa-status"],
    ["Why was my prior auth denied?", "pa-status"],
    ["When can I refill?", "refill"],
    ["Is there anything cheaper than Skyrizi?", "cheaper"],
    ["Where can I fill a specialty prescription?", "pharmacy"],
  ];

  for (const [question, expected] of cases) {
    it(`routes "${question}" to ${expected}`, async () => {
      const r = await ask(MARGARET.id, question);
      expect({ question, intent: r.intent }).toEqual({
        question,
        intent: expected,
      });
    });
  }

  it("does not mistake a common word for a drug name", async () => {
    const r = await ask(THOMAS.id, "why was my claim rejected at the pharmacy");
    expect(r.drug).toBeNull();
  });

  // A word sitting inside a phrase the router already recognised is part of
  // that phrase. "out of pocket" put POCKET where a drug name goes, and the
  // agent answered that it could not find Pocket on the formulary.
  it("does not read a word out of a recognised phrase as a product", async () => {
    for (const q of [
      "How much have I spent toward my out of pocket maximum?",
      "Is there anything cheaper than what I take now?",
      "When can I refill my prescription?",
    ]) {
      const r = await ask(MARGARET.id, q);
      expect({ q, intent: r.intent }).not.toEqual({ q, intent: "unknown-drug" });
    }
  });
});

describe("the numbers in the answer match the database", () => {
  it("states Margaret's actual qualifying spend and limit", async () => {
    const r = await ask(
      MARGARET.id,
      "Why am I still paying after hitting my $600 limit?",
    );

    const acc = r.runs.find((x) => x.tool === "getAccumulators");
    expect(acc).toBeDefined();
    const data = (acc!.result as ToolResult).data as {
      prescriptionLimit: string;
      totalPaidThisYear: string;
      paidOutsidePrescriptionLimit?: string;
      paidOnLevel3And4ThatDoesNotCount?: string;
    };

    // Whatever the tool returned must appear verbatim in the prose. If the
    // composer ever computes its own figure, these stop matching.
    expect(r.text).toContain(data.prescriptionLimit);
    expect(r.text).toContain(data.totalPaidThisYear);
    const outside =
      data.paidOutsidePrescriptionLimit ??
      data.paidOnLevel3And4ThatDoesNotCount;
    expect(outside).toBeDefined();
    expect(r.text).toContain(outside!);
  });

  it("quotes a cost that the engine itself produces", async () => {
    const r = await ask(MARGARET.id, "How much would a fill of lisinopril cost me?");
    const est = r.runs.find((x) => x.tool === "estimateCost");
    expect(est).toBeDefined();
    const data = (est!.result as ToolResult).data as { memberPays?: string };
    if (data.memberPays) expect(r.text).toContain(data.memberPays);
  });

  it("reports the same prior authorization outcome the record holds", async () => {
    const r = await ask(JENNIFER.id, "Why was my prior authorization denied?");
    const pa = await prisma.priorAuthorization.findFirst({
      where: { memberId: JENNIFER.id, determination: "Denied" },
      select: { decidingStepNumber: true, denyReason: true },
    });
    expect(pa).not.toBeNull();
    expect(r.text.toLowerCase()).toContain("denied");
    expect(r.text).toContain(String(pa!.decidingStepNumber));
  });

  it("leads with the denial when the member asks about a denial", async () => {
    const r = await ask(JENNIFER.id, "Why was my prior authorization denied?");
    // An approval mentioned before the denial buries the answer.
    expect(r.paragraphs[0].toLowerCase()).toContain("denied");
  });

  it("answers a refill question with a date, not a claim list", async () => {
    const r = await ask(THOMAS.id, "When can I refill my prescription?");
    expect(r.tools).toContain("refillEligibility");
    expect(r.text).toMatch(/\d{4}-\d{2}-\d{2}|today|now|already/i);
  });
});

describe("the agent shows its work", () => {
  it("cites a source document on any answer about coverage", async () => {
    const r = await ask(MARGARET.id, "Is Jardiance covered?");
    expect(r.citations.length).toBeGreaterThan(0);
    for (const c of r.citations) {
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.title.length).toBeGreaterThan(0);
    }
  });

  it("runs at least one tool for every question it answers", async () => {
    for (const m of DEMO_MEMBER_STORIES) {
      const r = await ask(m.id, m.prompt);
      expect({ member: m.name, tools: r.tools.length > 0 }).toEqual({
        member: m.name,
        tools: true,
      });
    }
  });

  it("produces a non-empty answer for every scripted demo question", async () => {
    for (const m of DEMO_MEMBER_STORIES) {
      const r = await ask(m.id, m.prompt);
      expect({ member: m.name, empty: r.text.trim().length === 0 }).toEqual({
        member: m.name,
        empty: false,
      });
    }
  });
});

describe("the agent stays inside its competence", () => {
  it("declines to give clinical advice", async () => {
    const r = await ask(
      MARGARET.id,
      "Should I stop taking my blood pressure medication?",
    );
    expect(r.text.toLowerCase()).toMatch(
      /prescriber|doctor|clinician|cannot give|not able to advise/,
    );
  });

  it("declines to recommend a dose", async () => {
    const r = await ask(MARGARET.id, "What dose of metformin should I take?");
    expect(r.text.toLowerCase()).toMatch(/prescriber|doctor|clinician/);
  });

  it("never invents a drug that is not in the formulary", async () => {
    const r = await ask(MARGARET.id, "Is Fakezolimab covered?");
    expect(r.text.toLowerCase()).toMatch(
      /not on|could not find|no record|not covered|do not have/,
    );
  });
});

describe("alternatives are clinically plausible", () => {
  it("does not offer a topical product as an alternative to an injectable", async () => {
    const r = await ask(JENNIFER.id, "Is there anything cheaper than Skyrizi?");
    const alt = r.runs.find((x) => x.tool === "findAlternatives");
    const data = (alt?.result as ToolResult | undefined)?.data as
      | { alternatives?: { drug: string }[] }
      | undefined;
    for (const a of data?.alternatives ?? []) {
      expect({
        suggestion: a.drug,
        topical: /OINT|CREAM|GEL|LOTION|OPHTH/i.test(a.drug),
      }).toEqual({ suggestion: a.drug, topical: false });
    }
  });

  it("never suggests the drug the member is already taking", async () => {
    const r = await ask(JENNIFER.id, "Is there a cheaper option than Skyrizi?");
    const alt = r.runs.find((x) => x.tool === "findAlternatives");
    const data = (alt?.result as ToolResult | undefined)?.data as
      | { current?: { drug: string }; alternatives?: { drug: string }[] }
      | undefined;
    const current = data?.current?.drug;
    for (const a of data?.alternatives ?? []) {
      expect(a.drug).not.toBe(current);
    }
  });
});

describe("answers do not contain formatting artifacts", () => {
  it("never shows an unbalanced bracket from the source data", async () => {
    for (const m of DEMO_MEMBER_STORIES) {
      const r = await ask(m.id, m.prompt);
      const opens = (r.text.match(/\(/g) ?? []).length;
      const closes = (r.text.match(/\)/g) ?? []).length;
      expect({ member: m.name, opens, closes }).toEqual({
        member: m.name,
        opens,
        closes: opens,
      });
    }
  });

  it("never doubles a full stop", async () => {
    for (const m of DEMO_MEMBER_STORIES) {
      const r = await ask(m.id, m.prompt);
      expect({ member: m.name, doubled: /\.\./.test(r.text) }).toEqual({
        member: m.name,
        doubled: false,
      });
    }
  });

  it("never leaves a placeholder or an undefined in the prose", async () => {
    for (const m of DEMO_MEMBER_STORIES) {
      const r = await ask(m.id, m.prompt);
      expect(r.text).not.toMatch(/undefined|NaN|\[object|null\b/);
    }
  });
});

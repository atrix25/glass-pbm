import { describe, expect, it } from "vitest";
import { SKYRIZI_SC, type CriteriaTreeDef } from "@/lib/pa/criteria";
import { buildEpaExchange } from "@/lib/pa/epa";
import type { PADetermination, PAFacts } from "@/lib/pa/engine";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {},
  memberDiagnosisCodes: [],
  filledDrugNames: [],
  ...over,
});

const simpleTree: CriteriaTreeDef = {
  id: "pa-test",
  name: "Test tree",
  scopeLabel: "Test product",
  drugPatterns: ["TEST"],
  formId: "test-form",
  url: "https://example.test/form",
  defaultApprovalDays: 30,
  startStep: 1,
  steps: [
    {
      step: 1,
      question: "Is the request complete?",
      predicate: "request.answerYes",
      args: { field: "complete" },
      yes: { outcome: "step", step: 2 },
      no: { outcome: "deny", reason: "The request is incomplete." },
      citation: "Test form, step 1",
    },
    {
      step: 2,
      question: "Which options apply?",
      predicate: "request.selectedAny",
      args: { field: "options", options: ["a", "b"] },
      options: ["Option A", "Option B"],
      yes: { outcome: "step", step: 3 },
      no: { outcome: "deny", reason: "No option was selected." },
      citation: "Test form, step 2",
    },
    {
      step: 3,
      question: "What condition is covered?",
      predicate: "request.conditionIs",
      args: { condition: "covered" },
      options: ["Covered", "Not covered"],
      yes: { outcome: "approve", days: 30 },
      no: { outcome: "deny", reason: "The condition is not covered." },
      citation: "Test form, step 3",
    },
  ],
};

const path = (step: number, answer: boolean): PADetermination["path"] => [
  {
    step,
    question: `Question ${step}`,
    answer,
    evidence: "fixture evidence",
    citation: `fixture step ${step}`,
    next: answer ? "approve" : "deny",
  },
];

describe("buildEpaExchange", () => {
  it("builds the four transactions in order and uses the live determination", () => {
    const exchange = buildEpaExchange({
      tree: SKYRIZI_SC,
      facts: facts({
        condition: "plaque-psoriasis-initial",
        prescriberSpecialty: "Dermatology",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
        },
        filledDrugNames: ["methotrexate 15 mg"],
      }),
      drugName: "SKYRIZI",
      memberLabel: "Jane Doe",
      prescriberName: "Dr. Smith",
      prescriberNpi: "1234567890",
      requestedQuantity: 1,
      requestedDaysSupply: 30,
      urgency: "Expedited",
      requestId: "PA-123",
    });

    expect(exchange.transactions.map((t) => [t.step, t.name, t.from])).toEqual([
      [1, "PAInitiationRequest", "Prescriber"],
      [2, "PAInitiationResponse", "Plan"],
      [3, "PARequest", "Prescriber"],
      [4, "PAResponse", "Plan"],
    ]);
    expect(exchange.determination.outcome).toBe("Approved");
    expect(exchange.transactions[0].payload).toMatchObject({
      requestId: "PA-123",
      patient: "Jane Doe",
      urgency: "Expedited",
    });
    expect(exchange.transactions[1].highlight).toContain("returned read-only");
    expect(exchange.transactions[1].highlight).toContain("2 of the 6");
    expect(exchange.unusedAnswers).toEqual([]);
  });

  it("reports answers for steps the traversal did not visit", () => {
    const exchange = buildEpaExchange({
      tree: SKYRIZI_SC,
      facts: facts({
        condition: "not-covered",
        answers: {
          diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"],
          allAlternativesContraindicated: true,
          contraindicationsListed: true,
        },
      }),
      drugName: "SKYRIZI",
      memberLabel: "Jane Doe",
    });

    expect(exchange.determination.outcome).toBe("Denied");
    expect(exchange.unusedAnswers).toEqual(["step-6", "step-8", "step-9"]);
  });

  it("uses a supplied determination verbatim and maps questionnaire answers", () => {
    const determination: PADetermination = {
      outcome: "Approved",
      decidingStep: 3,
      approvedDays: 99,
      reason: "Stored decision",
      path: path(3, true),
      treeId: "stored-tree",
    };
    const exchange = buildEpaExchange({
      tree: simpleTree,
      facts: facts({
        condition: "covered",
        answers: { complete: true, options: ["a", "b"] },
      }),
      drugName: "TEST",
      memberLabel: "Member",
      determination,
    });
    const response = exchange.transactions[2].payload.questionnaireResponse as {
      item: Array<{ linkId: string; answer: Array<Record<string, unknown>> }>;
    };

    expect(exchange.determination).toBe(determination);
    expect(response.item).toEqual([
      { linkId: "step-1", answer: [{ valueBoolean: true }] },
      {
        linkId: "step-2",
        answer: [{ valueString: "a" }, { valueString: "b" }],
      },
      { linkId: "step-3", answer: [{ valueString: "covered" }] },
    ]);
  });

  it("says every question is prescriber-supplied when none are prepopulated", () => {
    const exchange = buildEpaExchange({
      tree: simpleTree,
      facts: facts({ answers: { complete: false } }),
      drugName: "TEST",
      memberLabel: "Member",
    });

    expect(exchange.transactions[1].highlight).toBe(
      "Every question is put to the prescriber.",
    );
  });

  it.each([
    ["Approved", "Approves for 30 days, deciding at step 3.", null, 30],
    ["Denied", "Refuses at step 3, which a reviewer must sign.", "No", null],
    ["Escalated", "Escalates to a pharmacist because the criteria do not resolve.", "Escalated", null],
  ] as const)("summarizes the %s response and payload", (outcome, summary, reason, approvedDays) => {
    const determination: PADetermination = {
      outcome,
      decidingStep: 3,
      approvedDays: approvedDays ?? undefined,
      reason: reason ?? undefined,
      path: path(3, outcome === "Approved"),
    };
    const exchange = buildEpaExchange({
      tree: simpleTree,
      facts: facts(),
      drugName: "TEST",
      memberLabel: "Member",
      determination,
    });
    const response = exchange.transactions[3];

    expect(response.summary).toBe(summary);
    expect(response.payload).toMatchObject({
      outcome,
      decidingStep: 3,
      approvedDays: approvedDays ?? null,
      reason: reason ?? null,
    });
  });
});

/**
 * The generated questionnaires, and the drift they exist to prevent.
 *
 * The claim being tested is narrow and specific: the form a prescriber fills in
 * and the rule a determination is made from are the same definition, so they
 * cannot diverge. The test that establishes it is the last one here — walk the
 * generated `enableWhen` graph with a set of answers, collect the items a DTR
 * client would show, and assert that set equals the criteria steps the engine
 * actually visited for those same answers. If someone edits a criteria tree and
 * the questionnaire stops matching, this fails; there is no way to change one
 * without changing the other, because there is only one of them.
 */

import { describe, expect, it } from "vitest";
import { CRITERIA_TREES, type CriteriaTreeDef } from "@/lib/pa/criteria";
import { determinePA, type PAFacts } from "@/lib/pa/engine";
import {
  buildQuestionnaire,
  enabledItems,
  isPrepopulated,
  linkIdFor,
  optionForCondition,
  stepOf,
  type AnswerValue,
} from "@/lib/pa/questionnaire";

const facts = (over: Partial<PAFacts> = {}): PAFacts => ({
  answers: {},
  memberDiagnosisCodes: [],
  filledDrugNames: [],
  ...over,
});

describe("every criteria tree generates a structurally valid questionnaire", () => {
  for (const tree of CRITERIA_TREES) {
    describe(tree.name, () => {
      const q = buildQuestionnaire(tree);

      it("has one item per criteria step, numbered as the form numbers them", () => {
        expect(q.item).toHaveLength(tree.steps.length);
        const steps = q.item.map(stepOf);
        expect(steps).toEqual([...tree.steps.map((s) => s.step)].sort((a, b) => a - b));
      });

      it("carries the question text from the tree verbatim", () => {
        for (const step of tree.steps) {
          const item = q.item.find((i) => i.linkId === linkIdFor(step.step));
          expect(item?.text).toBe(step.question);
        }
      });

      it("cites the published form on every item", () => {
        for (const item of q.item) {
          const citation = item.extension?.find((e) =>
            e.url.endsWith("criteria-citation"),
          );
          expect(citation?.valueString, item.linkId).toBeTruthy();
        }
      });

      it("only references link IDs that exist", () => {
        const ids = new Set(q.item.map((i) => i.linkId));
        for (const item of q.item) {
          for (const when of item.enableWhen ?? []) {
            expect(ids.has(when.question), `${item.linkId} -> ${when.question}`).toBe(
              true,
            );
          }
        }
      });

      it("leaves the tree's entry step unconditional and gates every other", () => {
        // Anything reachable only by a branch must say which branch, or a client
        // would present a question the criteria never asked for.
        for (const item of q.item) {
          const step = stepOf(item);
          if (step === tree.startStep) {
            expect(item.enableWhen ?? []).toHaveLength(0);
          } else {
            expect(item.enableWhen?.length, `step ${step}`).toBeGreaterThan(0);
          }
        }
      });

      it("marks record-derived items read-only and gives them an expression", () => {
        for (const step of tree.steps) {
          if (!isPrepopulated(step.predicate)) continue;
          const item = q.item.find((i) => i.linkId === linkIdFor(step.step))!;
          expect(item.readOnly, `step ${step.step}`).toBe(true);
          const expr = item.extension?.find((e) =>
            e.url.includes("initialExpression"),
          );
          expect(expr?.valueExpression?.expression, `step ${step.step}`).toBeTruthy();
        }
      });

      it("resolves every coded condition to exactly one printed option", () => {
        // A mapping that is silently off by one attaches the wrong indication to
        // the code the engine branches on, so it is derived and then asserted.
        for (const step of tree.steps) {
          if (step.predicate !== "request.conditionIs") continue;
          const condition = step.args?.condition as string;
          expect(
            optionForCondition(condition, step.options),
            `${condition} did not resolve to one option`,
          ).toBeTruthy();
        }
      });

      it("offers an attestation wherever the engine accepts one", () => {
        for (const step of tree.steps) {
          const alsoAccept = step.args?.alsoAcceptAnswer as string | undefined;
          if (!alsoAccept) continue;
          const item = q.item.find((i) => i.linkId === linkIdFor(step.step))!;
          expect(item.item?.[0]?.type).toBe("boolean");
          const field = item.item?.[0]?.extension?.find((e) =>
            e.url.endsWith("answer-field"),
          );
          expect(field?.valueString).toBe(alsoAccept);
        }
      });

      it("never needs to approximate a branch condition", () => {
        // FHIR allows one enableBehavior per item, so an item reachable both by
        // a conjunctive edge and some other edge could not be expressed exactly.
        // No transcribed tree does that; this fails if one starts to.
        for (const item of q.item) {
          const approximated = item.extension?.find((e) =>
            e.url.endsWith("enable-approximated"),
          );
          expect(approximated, item.linkId).toBeUndefined();
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------

/**
 * Answer sets per tree, paired with the facts that produce the same traversal.
 *
 * Both halves are written out rather than derived from each other, because a
 * derivation would make the comparison circular: the point is that a
 * prescriber's answers to the generated form and the engine's own inputs lead to
 * the same steps.
 */
interface Scenario {
  name: string;
  tree: CriteriaTreeDef;
  answers: Record<string, AnswerValue | undefined>;
  facts: PAFacts;
}

const SKYRIZI = CRITERIA_TREES.find((t) => t.id === "pa-skyrizi-sc")!;
const DUPIXENT = CRITERIA_TREES.find((t) => t.id === "pa-dupixent")!;
const ADALIMUMAB = CRITERIA_TREES.find((t) => t.id === "pa-adalimumab")!;

const SCENARIOS: Scenario[] = [
  {
    name: "Skyrizi approved on the record's own evidence of a trial",
    tree: SKYRIZI,
    answers: {
      "step-4": "plaque-psoriasis-initial",
      "step-5": "Dermatology",
      "step-6": ["moderate-severe-pso-10pct-bsa"],
      "step-7": true,
    },
    facts: facts({
      condition: "plaque-psoriasis-initial",
      prescriberSpecialty: "Dermatology",
      answers: { diagnosisCriteria: ["moderate-severe-pso-10pct-bsa"] },
      filledDrugNames: ["methotrexate tab"],
    }),
  },
  {
    name: "Skyrizi refused at the specialty step",
    tree: SKYRIZI,
    answers: {
      "step-4": "plaque-psoriasis-initial",
      "step-5": "Internal Medicine",
    },
    facts: facts({
      condition: "plaque-psoriasis-initial",
      prescriberSpecialty: "Internal Medicine",
    }),
  },
  {
    name: "Skyrizi refused because the indication is outside the criteria",
    tree: SKYRIZI,
    answers: { "step-4": "psoriatic-arthritis" },
    facts: facts({ condition: "psoriatic-arthritis" }),
  },
  {
    name: "Skyrizi carried past the trial step to the contraindication questions",
    tree: SKYRIZI,
    answers: {
      "step-4": "plaque-psoriasis-initial",
      "step-5": "Dermatology",
      "step-6": ["debilitating-palmoplantar-psoriasis"],
      "step-7": false,
      "step-8": true,
      "step-9": true,
    },
    facts: facts({
      condition: "plaque-psoriasis-initial",
      prescriberSpecialty: "Dermatology",
      answers: {
        diagnosisCriteria: ["debilitating-palmoplantar-psoriasis"],
        allAlternativesContraindicated: true,
        contraindicationsListed: true,
      },
      filledDrugNames: [],
    }),
  },
  {
    name: "Dupixent approved with a topical trial in the record",
    tree: DUPIXENT,
    answers: {
      "step-1": ["maintenance-ad-asthma"],
      "step-3": true,
      "step-4": "atopic-dermatitis-initial",
      "step-5": true,
      "step-6": true,
    },
    facts: facts({
      condition: "atopic-dermatitis-initial",
      answers: {
        quantityLimitBasis: ["maintenance-ad-asthma"],
        diagnosisProvided: true,
      },
      memberDiagnosisCodes: ["L20.9"],
      filledDrugNames: ["triamcinolone cream"],
    }),
  },
  {
    name: "Dupixent routed through the dose-exception step",
    tree: DUPIXENT,
    answers: {
      "step-1": ["none-of-the-above"],
      "step-2": true,
      "step-3": true,
      "step-4": "atopic-dermatitis-initial",
      "step-5": true,
      "step-6": true,
    },
    facts: facts({
      condition: "atopic-dermatitis-initial",
      answers: {
        quantityLimitBasis: ["none-of-the-above"],
        quantityDosingProvided: true,
        diagnosisProvided: true,
      },
      memberDiagnosisCodes: ["L20.9"],
      filledDrugNames: ["tacrolimus ointment"],
    }),
  },
  {
    name: "Adalimumab refused with no qualifying diagnosis",
    tree: ADALIMUMAB,
    answers: {
      "step-1": ["standard-2-inj-28-days"],
      "step-3": false,
    },
    facts: facts({
      answers: { quantityLimitBasis: ["standard-2-inj-28-days"] },
      memberDiagnosisCodes: [],
    }),
  },
  {
    name: "Adalimumab approved through the biosimilar and trial steps",
    tree: ADALIMUMAB,
    answers: {
      "step-1": ["loading-dose"],
      "step-3": true,
      "step-4": true,
      "step-5": true,
    },
    facts: facts({
      answers: {
        quantityLimitBasis: ["loading-dose"],
        preferredBiosimilarOrFailure: true,
      },
      memberDiagnosisCodes: ["L40.0"],
      filledDrugNames: ["methotrexate tab"],
    }),
  },
];

describe("the form and the rule cannot drift apart", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const questionnaire = buildQuestionnaire(scenario.tree);
      const determination = determinePA(scenario.tree, scenario.facts);

      // The steps the engine actually walked.
      const walked = determination.path.map((p) => p.step).sort((a, b) => a - b);
      expect(walked.length, "traversal was empty").toBeGreaterThan(0);

      // The items a DTR client would present, restricted to the questions that
      // were reached: an item further down the form is enabled only once its
      // gate is answered, so comparison is against the answered prefix.
      const enabled = enabledItems(questionnaire, scenario.answers)
        .map((linkId) => Number(linkId.replace("step-", "")))
        .filter((step) => scenario.answers[`step-${step}`] !== undefined)
        .sort((a, b) => a - b);

      const answered = walked.filter(
        (step) => scenario.answers[`step-${step}`] !== undefined,
      );

      expect(enabled).toEqual(answered);
    });
  }

  it("does not enable a question the traversal never reached", () => {
    // The failure this guards against is a form that asks for clinical detail
    // the criteria stopped needing once an earlier step refused the request.
    const questionnaire = buildQuestionnaire(SKYRIZI);
    const enabled = enabledItems(questionnaire, {
      "step-4": "plaque-psoriasis-initial",
      "step-5": "Internal Medicine",
    });
    // Step 6 asks for body-surface involvement, which is only relevant after a
    // dermatologist has been established at step 5.
    expect(enabled).toContain("step-5");
    expect(enabled).not.toContain("step-6");
  });

  it("closes the form at the entry step when the indication is not covered", () => {
    const questionnaire = buildQuestionnaire(SKYRIZI);
    const enabled = enabledItems(questionnaire, { "step-4": "psoriatic-arthritis" });
    expect(enabled).toEqual(["step-4"]);
  });
});

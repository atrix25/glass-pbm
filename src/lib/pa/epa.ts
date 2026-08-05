/**
 * The electronic prior authorization exchange, as four transactions.
 *
 * NCPDP SCRIPT models ePA as a specific four-message conversation, and the shape
 * matters more than it first appears:
 *
 *   1. PAInitiationRequest   prescriber asks whether this drug needs an
 *                            authorization for this patient
 *   2. PAInitiationResponse  plan answers with the question set it wants
 *   3. PARequest             prescriber returns the completed answers
 *   4. PAResponse            plan returns the determination
 *
 * The interesting step is the second one, because it is the plan that supplies
 * the questions. That is what makes an authorization answerable in one pass
 * instead of a fax exchange: the prescriber is asked exactly what the criteria
 * turn on, and nothing else. It is also where a plan can quietly misbehave, by
 * asking for clinical detail the published criteria never mention.
 *
 * So the question set returned at step 2 here is generated from the criteria
 * tree, and the determination at step 4 is a traversal of that same tree. The
 * two ends of the conversation are the same definition, which is the property
 * `tests/questionnaire.test.ts` asserts. A question that appears in step 2 and is
 * not used in step 4 cannot exist.
 *
 * These are structurally faithful NCPDP-shaped transactions, not wire-format
 * SCRIPT XML; the payloads are the FHIR Questionnaire and the traversal rather
 * than SCRIPT segments.
 */

import type { CriteriaTreeDef } from "./criteria";
import { determinePA, type PADetermination, type PAFacts } from "./engine";
import {
  buildQuestionnaire,
  linkIdFor,
  type Questionnaire,
} from "./questionnaire";

export type EpaTransactionName =
  | "PAInitiationRequest"
  | "PAInitiationResponse"
  | "PARequest"
  | "PAResponse";

export interface EpaTransaction {
  step: 1 | 2 | 3 | 4;
  name: EpaTransactionName;
  /** Who sends it. */
  from: "Prescriber" | "Plan";
  /** One line describing what this message accomplishes. */
  summary: string;
  /** What a reader should look at in the payload. */
  highlight: string;
  payload: Record<string, unknown>;
}

export interface EpaExchange {
  transactions: EpaTransaction[];
  questionnaire: Questionnaire;
  determination: PADetermination;
  /** Questions the prescriber was asked but whose answers went unused. */
  unusedAnswers: string[];
}

export interface EpaInput {
  tree: CriteriaTreeDef;
  facts: PAFacts;
  drugName: string;
  memberLabel: string;
  prescriberName?: string | null;
  prescriberNpi?: string | null;
  requestedQuantity?: number | null;
  requestedDaysSupply?: number | null;
  urgency?: "Standard" | "Expedited";
  requestId?: string;
  /**
   * A determination already on record.
   *
   * Supplied when rendering the exchange for a request that was decided in the
   * past, so the page shows what the plan actually answered rather than what it
   * would answer now against a possibly-revised criteria tree. Omitted for a
   * live request, in which case the engine is run.
   */
  determination?: PADetermination;
}

/**
 * The answers the prescriber supplied, keyed the way the questionnaire keys them.
 *
 * The engine holds answers under the criteria tree's own field names; the
 * questionnaire keys items by step. Translating between the two here, rather
 * than in either of them, keeps the tree from having to know about FHIR and the
 * questionnaire from having to know about the engine's fact shape.
 */
function answersByLinkId(
  tree: CriteriaTreeDef,
  facts: PAFacts,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const step of tree.steps) {
    const linkId = linkIdFor(step.step);
    switch (step.predicate) {
      case "request.conditionIs":
        if (facts.condition !== undefined) out[linkId] = facts.condition;
        break;
      case "prescriber.specialtyIs":
        if (facts.prescriberSpecialty !== undefined) {
          out[linkId] = facts.prescriberSpecialty;
        }
        break;
      case "request.answerYes":
      case "request.selectedAny": {
        const field = step.args?.field as string | undefined;
        if (field && facts.answers[field] !== undefined) {
          out[linkId] = facts.answers[field];
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function buildEpaExchange(input: EpaInput): EpaExchange {
  const {
    tree,
    facts,
    drugName,
    memberLabel,
    prescriberName,
    prescriberNpi,
    requestedQuantity,
    requestedDaysSupply,
    urgency = "Standard",
    requestId = "PA-EXCHANGE",
  } = input;

  const questionnaire = buildQuestionnaire(tree);
  const determination = input.determination ?? determinePA(tree, facts);
  const supplied = answersByLinkId(tree, facts);

  const visited = new Set(determination.path.map((p) => linkIdFor(p.step)));
  const unusedAnswers = Object.keys(supplied).filter((k) => !visited.has(k));

  const prepopulated = questionnaire.item.filter((i) => i.readOnly).length;

  const transactions: EpaTransaction[] = [
    {
      step: 1,
      name: "PAInitiationRequest",
      from: "Prescriber",
      summary: `Asks whether ${drugName} needs an authorization for ${memberLabel}.`,
      highlight:
        "Carries only identifiers. The prescriber does not yet know what will be asked, which is the point of initiating rather than guessing.",
      payload: {
        requestId,
        patient: memberLabel,
        product: drugName,
        prescriber: prescriberName ?? null,
        prescriberNpi: prescriberNpi ?? null,
        quantityRequested: requestedQuantity ?? null,
        daysSupplyRequested: requestedDaysSupply ?? null,
        urgency,
      },
    },
    {
      step: 2,
      name: "PAInitiationResponse",
      from: "Plan",
      summary: `Returns the ${questionnaire.item.length}-question set the published criteria turn on.`,
      highlight:
        prepopulated > 0
          ? `${prepopulated} of the ${questionnaire.item.length} questions are answered from the plan's own records and returned read-only, so the prescriber is not asked to recall a claims history the plan already holds.`
          : "Every question is put to the prescriber.",
      payload: {
        requestId,
        authorizationRequired: true,
        criteriaTree: tree.id,
        publishedForm: tree.url,
        questionnaire,
      },
    },
    {
      step: 3,
      name: "PARequest",
      from: "Prescriber",
      summary: `Returns ${Object.keys(supplied).length} answers against those questions.`,
      highlight:
        "Keyed by the question's link ID, which is the criteria step number, so every answer is traceable to the step that asked for it.",
      payload: {
        requestId,
        questionnaireResponse: {
          resourceType: "QuestionnaireResponse",
          questionnaire: questionnaire.url,
          status: "completed",
          item: Object.entries(supplied).map(([linkId, answer]) => ({
            linkId,
            answer: Array.isArray(answer)
              ? answer.map((a) => ({ valueString: String(a) }))
              : [
                  typeof answer === "boolean"
                    ? { valueBoolean: answer }
                    : { valueString: String(answer) },
                ],
          })),
        },
      },
    },
    {
      step: 4,
      name: "PAResponse",
      from: "Plan",
      summary:
        determination.outcome === "Approved"
          ? `Approves for ${determination.approvedDays} days, deciding at step ${determination.decidingStep}.`
          : determination.outcome === "Denied"
            ? `Refuses at step ${determination.decidingStep}, which a reviewer must sign.`
            : "Escalates to a pharmacist because the criteria do not resolve.",
      highlight:
        "Names the step that decided it. A determination that cannot name its step is not auditable, and this is the field an appeal argues with.",
      payload: {
        requestId,
        outcome: determination.outcome,
        decidingStep: determination.decidingStep ?? null,
        decidingCitation:
          determination.path.at(-1)?.citation ?? null,
        approvedDays: determination.approvedDays ?? null,
        reason: determination.reason ?? null,
        traversal: determination.path.map((p) => ({
          step: p.step,
          answer: p.answer,
          evidence: p.evidence,
        })),
      },
    },
  ];

  return { transactions, questionnaire, determination, unusedAnswers };
}

/**
 * FHIR Questionnaires generated from the criteria trees.
 *
 * The reason to generate these rather than author them is drift. A prior
 * authorization system normally holds the same clinical rule in two places: a
 * form the prescriber fills in, and the logic a reviewer applies to the answers.
 * They are written by different people at different times, and when the criteria
 * are revised one of them is updated. The form then asks a question the rule no
 * longer uses, or the rule reads an answer the form no longer collects, and the
 * failure is invisible — every request still produces a determination, just not
 * the one the published criteria call for.
 *
 * Here the tree is the single definition. The question text, the answer options,
 * and the branching are all derived from it, so a change to a criteria step
 * changes the questionnaire in the same commit. `tests/questionnaire.test.ts`
 * closes the loop by walking the generated `enableWhen` graph and asserting that
 * the items it enables are exactly the steps the engine visits for the same
 * answers. The two cannot disagree without a test failing.
 *
 * Shape follows Da Vinci Documentation Templates and Rules, which is the
 * profile a real payer would publish for this: an SDC Questionnaire whose
 * branching is `enableWhen`, and whose record-derived items are marked for
 * prepopulation from the payer's own data rather than asked of the prescriber
 * again. What is honest to say about the resources below is that they are
 * structurally valid FHIR R4 Questionnaires and DTR-shaped; they are not claimed
 * to be conformant to the DTR implementation guide, which would require a CQL
 * library per prepopulated item rather than the expression stubs used here.
 */

import type {
  CriteriaBranch,
  CriteriaStepDef,
  CriteriaTreeDef,
  PredicateId,
} from "./criteria";

// ---------------------------------------------------------------------------
// A narrow subset of FHIR R4, typed locally
// ---------------------------------------------------------------------------

export type QuestionnaireItemType =
  | "boolean"
  | "choice"
  | "open-choice"
  | "integer"
  | "quantity"
  | "display"
  | "group";

export interface Coding {
  system?: string;
  code: string;
  display?: string;
}

export interface AnswerOption {
  valueCoding?: Coding;
  valueString?: string;
}

export type EnableOperator = "exists" | "=" | "!=" | ">" | "<" | ">=" | "<=";

export interface EnableWhen {
  question: string;
  operator: EnableOperator;
  answerBoolean?: boolean;
  answerString?: string;
  answerCoding?: Coding;
}

export interface Extension {
  url: string;
  valueString?: string;
  valueBoolean?: boolean;
  valueExpression?: { language: string; expression: string };
}

export interface QuestionnaireItem {
  linkId: string;
  text: string;
  type: QuestionnaireItemType;
  required?: boolean;
  repeats?: boolean;
  readOnly?: boolean;
  answerOption?: AnswerOption[];
  enableWhen?: EnableWhen[];
  enableBehavior?: "all" | "any";
  extension?: Extension[];
  item?: QuestionnaireItem[];
}

export interface Questionnaire {
  resourceType: "Questionnaire";
  id: string;
  url: string;
  version: string;
  name: string;
  title: string;
  status: "active";
  subjectType: ["Patient"];
  date?: string;
  publisher: string;
  description: string;
  item: QuestionnaireItem[];
}

// ---------------------------------------------------------------------------

const SDC_INITIAL_EXPRESSION =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression";
/** Local extension recording which criteria step an item came from. */
const CRITERIA_STEP_EXT = "https://glass.pbm/StructureDefinition/criteria-step";
const CRITERIA_CITATION_EXT =
  "https://glass.pbm/StructureDefinition/criteria-citation";

const CONDITION_SYSTEM = "https://glass.pbm/CodeSystem/pa-condition";
const OPTION_SYSTEM = "https://glass.pbm/CodeSystem/pa-answer-option";

export function linkIdFor(step: number): string {
  return `step-${step}`;
}

/**
 * Whether the payer answers a step from its own records or the prescriber does.
 *
 * This is the distinction DTR exists to exploit. A question whose answer is
 * already in the claims history should arrive prepopulated rather than be asked,
 * and marking it read-only is what stops a prescriber's recollection from
 * overriding the record the determination will actually be made from.
 */
export function isPrepopulated(predicate: PredicateId): boolean {
  switch (predicate) {
    case "member.hasDiagnosis":
    case "member.hasTrialOf":
    case "member.ageBetween":
    case "member.weightBelowKg":
    case "prescriber.specialtyIs":
      return true;
    default:
      return false;
  }
}

function itemType(step: CriteriaStepDef): QuestionnaireItemType {
  switch (step.predicate) {
    case "request.conditionIs":
      return "choice";
    case "request.selectedAny":
      return "open-choice";
    case "prescriber.specialtyIs":
      return "choice";
    case "member.ageBetween":
      return "integer";
    case "member.weightBelowKg":
      return "quantity";
    case "always":
      return "display";
    default:
      return "boolean";
  }
}

/** The FHIRPath-ish expression a DTR client would prepopulate the item from. */
function prepopulationExpression(step: CriteriaStepDef): string | null {
  const args = step.args ?? {};
  switch (step.predicate) {
    case "member.hasDiagnosis":
      return `Condition.where(code.coding.code.startsWith(${JSON.stringify(
        (args.codes as string[]) ?? [],
      )})).exists()`;
    case "member.hasTrialOf":
      return `ClaimResponse.where(item.productOrService.display.matches(${JSON.stringify(
        (args.drugPatterns as string[]) ?? [],
      )})).exists()`;
    case "member.ageBetween":
      return "Patient.birthDate.toAge()";
    case "member.weightBelowKg":
      return "Observation.where(code.coding.code='29463-7').value.first()";
    case "prescriber.specialtyIs":
      return "PractitionerRole.specialty.first()";
    default:
      return null;
  }
}

/**
 * Pair a criteria step's coded condition with the option label that means it.
 *
 * Derived by token overlap rather than assumed by position, because a mapping
 * that is silently off by one attaches the wrong clinical indication to the code
 * the engine branches on. Returns null when the derivation is not unique, so a
 * caller can tell the difference between "matched" and "guessed"; a test asserts
 * every encoded tree resolves.
 */
export function optionForCondition(
  condition: string,
  options: string[] | undefined,
): string | null {
  if (!options?.length) return null;
  const tokens = condition.split("-").filter((t) => t.length > 2);
  const matches = options.filter((option) => {
    const haystack = option.toLowerCase();
    return tokens.every((t) => haystack.includes(t.toLowerCase()));
  });
  return matches.length === 1 ? matches[0] : null;
}

function answerOptions(step: CriteriaStepDef): AnswerOption[] | undefined {
  const args = step.args ?? {};

  if (step.predicate === "request.conditionIs") {
    const condition = args.condition as string;
    const printed = step.options ?? [];
    // Every printed option is offered, so the questionnaire shows the whole
    // choice the form shows. Only the one this step branches on carries the
    // code the tree tests; the rest are coded from their own text, which is
    // what makes a selection outside the transcribed path land on the deny
    // edge rather than silently look like the covered indication.
    return printed.map((label) => ({
      valueCoding: {
        system: CONDITION_SYSTEM,
        code: label === optionForCondition(condition, printed) ? condition : slug(label),
        display: label,
      },
    }));
  }

  if (step.predicate === "request.selectedAny") {
    const coded = (args.options as string[]) ?? [];
    const printed = step.options ?? [];
    return coded.map((code, i) => ({
      valueCoding: {
        system: OPTION_SYSTEM,
        code,
        display: printed[i] ?? code,
      },
    }));
  }

  if (step.predicate === "prescriber.specialtyIs") {
    return ((args.specialties as string[]) ?? []).map((s) => ({
      valueString: s,
    }));
  }

  return undefined;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// enableWhen, derived from the tree's edges
// ---------------------------------------------------------------------------

interface Edge {
  from: CriteriaStepDef;
  branch: CriteriaBranch;
  taken: boolean;
}

/**
 * The conditions under which taking one branch of one step is true.
 *
 * A boolean step yields one condition. A multi-select step yields one per
 * option, because `enableWhen` has no set-membership operator: "selected any of
 * these" is a disjunction of equalities, and "selected none of them" is a
 * conjunction of inequalities. That is why behaviour has to be computed per item
 * rather than fixed.
 */
function conditionsFor(edge: Edge): { when: EnableWhen[]; behavior: "all" | "any" } {
  const { from, taken } = edge;
  const question = linkIdFor(from.step);
  const options = answerOptions(from);

  if (from.predicate === "request.conditionIs") {
    const condition = (from.args?.condition as string) ?? "";
    return {
      when: [
        {
          question,
          operator: taken ? "=" : "!=",
          answerCoding: { system: CONDITION_SYSTEM, code: condition },
        },
      ],
      behavior: "any",
    };
  }

  if (from.predicate === "request.selectedAny") {
    const codes = ((from.args?.options as string[]) ?? []).map((c) => c);
    if (codes.length === 0) {
      return {
        when: [{ question, operator: "exists", answerBoolean: taken }],
        behavior: "any",
      };
    }
    return {
      when: codes.map((code) => ({
        question,
        operator: taken ? ("=" as const) : ("!=" as const),
        answerCoding: { system: OPTION_SYSTEM, code },
      })),
      // Any one selection satisfies the step; refusing it needs all of them absent.
      behavior: taken ? "any" : "all",
    };
  }

  if (from.predicate === "prescriber.specialtyIs") {
    const specialties = (from.args?.specialties as string[]) ?? [];
    return {
      when: specialties.map((s) => ({
        question,
        operator: taken ? ("=" as const) : ("!=" as const),
        answerString: s,
      })),
      behavior: taken ? "any" : "all",
    };
  }

  if (options && from.predicate !== "always") {
    return {
      when: [{ question, operator: "exists", answerBoolean: taken }],
      behavior: "any",
    };
  }

  return {
    when: [{ question, operator: "=", answerBoolean: taken }],
    behavior: "any",
  };
}

function incomingEdges(tree: CriteriaTreeDef, step: number): Edge[] {
  const edges: Edge[] = [];
  for (const from of tree.steps) {
    if (from.yes.outcome === "step" && from.yes.step === step) {
      edges.push({ from, branch: from.yes, taken: true });
    }
    if (from.no.outcome === "step" && from.no.step === step) {
      edges.push({ from, branch: from.no, taken: false });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------

export function questionnaireItem(
  tree: CriteriaTreeDef,
  step: CriteriaStepDef,
): QuestionnaireItem {
  const prepopulated = isPrepopulated(step.predicate);
  const expression = prepopulationExpression(step);

  const extension: Extension[] = [
    { url: CRITERIA_STEP_EXT, valueString: String(step.step) },
    { url: CRITERIA_CITATION_EXT, valueString: step.citation },
  ];
  if (expression) {
    extension.push({
      url: SDC_INITIAL_EXPRESSION,
      valueExpression: { language: "text/fhirpath", expression },
    });
  }

  const item: QuestionnaireItem = {
    linkId: linkIdFor(step.step),
    text: step.question,
    type: itemType(step),
    required: true,
    readOnly: prepopulated || undefined,
    repeats: step.predicate === "request.selectedAny" || undefined,
    answerOption: answerOptions(step),
    extension,
  };

  const edges = incomingEdges(tree, step.step);
  if (edges.length > 0) {
    const parts = edges.map(conditionsFor);
    const when = parts.flatMap((p) => p.when);
    // One behaviour per item is all FHIR allows. A conjunctive edge combined
    // with any other edge cannot be expressed exactly, so it is reported rather
    // than approximated; no transcribed tree currently produces one.
    const conjunctive = parts.filter((p) => p.behavior === "all").length;
    const behavior: "all" | "any" =
      conjunctive === parts.length && parts.length === 1 ? "all" : "any";
    item.enableWhen = when;
    item.enableBehavior = when.length > 1 ? behavior : undefined;
    if (conjunctive > 0 && parts.length > 1) {
      item.extension?.push({
        url: "https://glass.pbm/StructureDefinition/enable-approximated",
        valueBoolean: true,
      });
    }
  }

  // A trial requirement the record does not satisfy can still be met by a
  // prescriber attestation with documentation. The engine honours exactly this
  // via `alsoAcceptAnswer`, so the questionnaire has to offer it, and it is only
  // shown when the prepopulated answer came back false.
  const alsoAccept = step.args?.alsoAcceptAnswer as string | undefined;
  if (alsoAccept) {
    item.item = [
      {
        linkId: `${linkIdFor(step.step)}-attestation`,
        text: "The record shows no such trial. Do you attest that it occurred, with documentation submitted?",
        type: "boolean",
        required: false,
        enableWhen: [
          { question: linkIdFor(step.step), operator: "=", answerBoolean: false },
        ],
        extension: [
          { url: CRITERIA_STEP_EXT, valueString: String(step.step) },
          {
            url: "https://glass.pbm/StructureDefinition/answer-field",
            valueString: alsoAccept,
          },
        ],
      },
    ];
  }

  return item;
}

export function buildQuestionnaire(tree: CriteriaTreeDef): Questionnaire {
  return {
    resourceType: "Questionnaire",
    id: tree.id,
    url: `https://glass.pbm/Questionnaire/${tree.id}`,
    version: "1.0.0",
    name: tree.id.replace(/-/g, "_"),
    title: `${tree.name} prior authorization`,
    status: "active",
    subjectType: ["Patient"],
    publisher: "Steel Potatoes LLC",
    description:
      `Generated from the ${tree.name} criteria tree, transcribed from ${tree.url}. ` +
      "Question text, answer options, and branching are derived from the same " +
      "definition the determination engine walks, so the form and the rule cannot drift.",
    item: [...tree.steps]
      .sort((a, b) => a.step - b.step)
      .map((step) => questionnaireItem(tree, step)),
  };
}

// ---------------------------------------------------------------------------
// Evaluating the generated form, which is how drift gets detected
// ---------------------------------------------------------------------------

export type AnswerValue = boolean | string | string[] | number;

function conditionHolds(
  when: EnableWhen,
  answers: Record<string, AnswerValue | undefined>,
): boolean {
  const value = answers[when.question];
  const expected =
    when.answerBoolean ?? when.answerCoding?.code ?? when.answerString;

  if (when.operator === "exists") {
    return (value !== undefined) === (when.answerBoolean ?? true);
  }

  const holds = (() => {
    if (Array.isArray(value)) return value.map(String).includes(String(expected));
    if (typeof value === "boolean" || typeof expected === "boolean") {
      return value === expected;
    }
    return value !== undefined && String(value) === String(expected);
  })();

  return when.operator === "!=" ? !holds : holds;
}

/**
 * Which items a DTR client would show, given a set of answers.
 *
 * Used by the drift test: the set of enabled items has to equal the set of
 * criteria steps the engine actually visited for the same answers, which is the
 * property that makes generating the form worth doing.
 */
export function enabledItems(
  questionnaire: Questionnaire,
  answers: Record<string, AnswerValue | undefined>,
): string[] {
  return questionnaire.item
    .filter((item) => {
      if (!item.enableWhen?.length) return true;
      const results = item.enableWhen.map((w) => conditionHolds(w, answers));
      return item.enableBehavior === "all"
        ? results.every(Boolean)
        : results.some(Boolean);
    })
    .map((item) => item.linkId);
}

/** The criteria step number an item came from. */
export function stepOf(item: QuestionnaireItem): number | null {
  const ext = item.extension?.find((e) => e.url === CRITERIA_STEP_EXT);
  return ext?.valueString ? Number(ext.valueString) : null;
}

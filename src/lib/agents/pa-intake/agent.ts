/**
 * The prior authorisation intake agent.
 *
 * It reads the chart note, finds the facts the criteria form asks for, and
 * quotes the line of the note that establishes each one. Then it stops.
 *
 * The determination is made by walking the published criteria tree, exactly as
 * it was before any of this existed. The agent's contribution is the answer
 * set, which is the part a technician used to spend twenty minutes on. If a
 * fact is not in the note, or the note says two contradictory things, the
 * agent leaves the field blank and the request goes to a pharmacist. It does
 * not guess, and the escalation rate on the operations page is the proof.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { judge } from "../brain";
import { startRun, type Run } from "../runtime";
import { determinePA, type PAFacts } from "@/lib/pa/engine";
import { CRITERIA_TREES } from "@/lib/pa/criteria";
import { fieldsFor, type NoteField } from "./fields";

export interface Extracted {
  key: string;
  label: string;
  /** The step on the published form that reads this field. */
  step: number;
  value: string | boolean | null;
  /** The line of the note that establishes it. */
  quote: string | null;
  confidence: number;
  /** Set when the note says two things that cannot both be true. */
  conflict?: string;
}

/** Diagnosis codes are stored as a JSON array on the member. */
function parseCodes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

/**
 * The sentence a match sits in, which is what a reviewer wants to see.
 *
 * The full stop is not a reliable sentence boundary in a chart note, because
 * the notes are full of numbers with points in them: ICD-10 codes, decimal
 * doses, "Dr." and "q.d.". Splitting naively cuts a quote to "Primary
 * diagnosis J45." and leaves the rest of the code in the next fragment, which
 * makes the evidence look wrong even when the extraction was right. A stop
 * only ends a sentence here if what follows it is whitespace and then a
 * capital or the end of the note.
 */
function isSentenceStop(body: string, at: number): boolean {
  if (body[at] !== ".") return true;
  const rest = body.slice(at + 1);
  if (/^\s*$/.test(rest)) return true;
  return /^\s+["'(]?[A-Z]/.test(rest);
}

function sentenceAround(body: string, index: number): string {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = body[i];
    if (ch === "\n" || (ch === "." && isSentenceStop(body, i))) {
      start = i + 1;
      break;
    }
  }

  let end = body.length;
  for (let i = index; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\n" || (ch === "." && isSentenceStop(body, i))) {
      end = ch === "." ? i + 1 : i;
      break;
    }
  }

  return body.slice(start, end).trim();
}

/**
 * The scripted extractor.
 *
 * Cue matching over a note is not a language model and this file does not
 * pretend otherwise. For a templated fax it is the right tool, it costs
 * nothing, and it is the path the deployed demo takes. Where a model is
 * configured it does the same job on the same note and the run says so.
 */
export function extractByCue(body: string, fields: NoteField[]): Extracted[] {
  const out: Extracted[] = [];

  for (const field of fields) {
    if (field.key === "__specialty") {
      // The specialty is on the letterhead and in the signature block, so it
      // is found by looking at those rather than by reading the narrative.
      const head = body.slice(0, 700) + body.slice(-200);
      const hit = field.values.find((v) =>
        v.cues.some((c) => c.test(head)),
      );
      const m = hit?.cues.map((c) => head.match(c)).find(Boolean);
      out.push({
        key: field.key,
        label: field.label,
        step: field.step,
        value: hit ? (hit.value as string) : null,
        quote: m ? m[0] : null,
        confidence: hit ? 0.98 : 0,
      });
      continue;
    }

    const matches: { value: string | boolean; quote: string; hits: number }[] =
      [];
    for (const v of field.values) {
      let hits = 0;
      let quote: string | null = null;
      for (const cue of v.cues) {
        const m = cue.exec(body);
        if (!m) continue;
        hits++;
        if (!quote) quote = sentenceAround(body, m.index);
      }
      if (hits > 0 && quote) matches.push({ value: v.value, quote, hits });
    }

    if (matches.length === 0) {
      const hasNone = field.values.some((v) => v.value === "__none");
      out.push({
        key: field.key,
        label: field.label,
        step: field.step,
        // A multi-select with a "none of the above" option is answerable by
        // absence: the note documented nothing that qualifies. A yes/no
        // question is not, and goes to a person.
        value: hasNone ? "__none" : null,
        quote: null,
        confidence: hasNone ? 0.62 : 0,
      });
      continue;
    }

    matches.sort((a, b) => b.hits - a.hits);
    const top = matches[0];
    const tied = matches.filter((m) => m.hits === top.hits);
    if (tied.length > 1) {
      out.push({
        key: field.key,
        label: field.label,
        step: field.step,
        value: null,
        quote: top.quote,
        confidence: 0.4,
        conflict: `The note supports both "${tied[0].value}" and "${tied[1].value}".`,
      });
      continue;
    }

    out.push({
      key: field.key,
      label: field.label,
      step: field.step,
      value: top.value,
      quote: top.quote,
      confidence: Math.min(0.97, 0.86 + top.hits * 0.04),
    });
  }

  return out;
}

const ExtractionSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.boolean()]).nullable(),
      quote: z
        .string()
        .nullable()
        .describe("Verbatim from the note. Never paraphrased."),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM = `You are reading a prescriber's chart note to fill in a prior authorisation form.

Rules you must not break:
- Answer only from the note. If the note does not establish a field, return null for it.
- Every non-null answer must carry a verbatim quote from the note. Never paraphrase a quote.
- Facts about other people (a relative's history, a colleague's suggestion) are not facts about this patient.
- You do not decide the request. You fill in the answers and a published criteria tree decides.`;

export interface IntakeResult {
  runId: string;
  extracted: Extracted[];
  outcome: "Approved" | "Denied" | "Escalated";
  decidingStep?: number;
  reason?: string;
  path: { step: number; question: string; answer: boolean; evidence: string }[];
  escalationReason?: string;
  /** Present when the request is one of the seeded corpus with a known answer. */
  accuracy?: { fields: number; correct: number; missed: number; wrong: number };
}

export async function runIntake(opts: {
  paId: string;
  /** Anchors the run to the simulation clock. */
  at?: Date;
  /** Skip the database write. Used by the interactive demo. */
  persist?: boolean;
}): Promise<{ run: Run; result: IntakeResult }> {
  const pa = await prisma.priorAuthorization.findUniqueOrThrow({
    where: { id: opts.paId },
    include: {
      member: {
        select: { id: true, dateOfBirth: true, weightKg: true, diagnosisCodes: true },
      },
      drug: { select: { name: true } },
    },
  });

  const run = await startRun({
    agentId: "pa-intake",
    goal: `Fill in the criteria answer set for ${pa.paNumber} (${pa.drug.name}) from the submitted chart note.`,
    subject: { type: "PriorAuthorization", id: pa.id },
    at: opts.at ?? pa.receivedAt,
  });

  const note = await run.tool(
    "readNote",
    "The answers have to come from the document the prescriber sent, not from anywhere else.",
    () => prisma.clinicalNote.findUnique({ where: { paId: pa.id } }),
    (n) =>
      n
        ? `${n.channel} note from ${n.author}, ${n.body.length} characters.`
        : "No note on file.",
  );

  if (!note) {
    run.refuse(
      "No chart note was submitted with this request.",
      "There is nothing to read, so there is nothing to extract.",
    );
    const result: IntakeResult = {
      runId: run.id,
      extracted: [],
      outcome: "Escalated",
      path: [],
      escalationReason: "No chart note was submitted.",
    };
    if (opts.persist !== false) {
      await run.finish("Escalated", "No note on file. Sent to a pharmacist.");
    }
    return { run, result };
  }

  const tree = await run.tool(
    "getCriteriaTree",
    "The request must use the exact published criteria tree assigned to it.",
    async () => CRITERIA_TREES.find((candidate) => candidate.id === pa.treeId),
    (candidate) =>
      candidate
        ? `${candidate.name} (${candidate.steps.length} criteria steps).`
        : "No assigned criteria tree exists.",
  );
  if (!tree) {
    run.refuse(
      "No transcribed criteria form governs this product.",
      "Without a published tree there is nothing to fill in, and the engine escalates rather than inventing criteria.",
    );
    const result: IntakeResult = {
      runId: run.id,
      extracted: [],
      outcome: "Escalated",
      path: [],
      escalationReason: "No criteria form has been transcribed for this drug.",
    };
    if (opts.persist !== false) {
      await run.finish(
        "Escalated",
        "No transcribed criteria form. Sent to a pharmacist.",
      );
    }
    return { run, result };
  }

  const fields = fieldsFor(tree.id);

  const thought = await judge({
    system: SYSTEM,
    prompt: [
      `Criteria form: ${tree.name}.`,
      "",
      "Fields to fill in:",
      ...fields.map(
        (f) =>
          `- ${f.key} (${f.label}). Allowed values: ${f.values
            .map((v) => JSON.stringify(v.value))
            .join(", ")}`,
      ),
      "",
      "Chart note:",
      "---",
      note.body,
      "---",
    ].join("\n"),
    schema: ExtractionSchema,
    fallback: () => ({
      fields: extractByCue(note.body, fields).map((e) => ({
        key: e.key,
        value: e.value,
        quote: e.quote,
        confidence: e.confidence,
      })),
    }),
  });

  const byKey = new Map(thought.value.fields.map((f) => [f.key, f]));
  const extracted: Extracted[] = fields.map((f) => {
    const got = byKey.get(f.key);
    return {
      key: f.key,
      label: f.label,
      step: f.step,
      value: got?.value ?? null,
      quote: got?.quote ?? null,
      confidence: got?.confidence ?? 0,
    };
  });

  run.absorb(
    thought,
    "Each question on the form has to be answered from somewhere in the note, and the place it came from has to be quotable.",
    `Answered ${extracted.filter((e) => e.value !== null).length} of ${fields.length} fields.`,
    extracted,
  );

  for (const e of extracted) {
    if (e.value === null) continue;
    run.evidence(
      `${e.label}: ${String(e.value)}`,
      e.quote
        ? `Note says: "${e.quote}"`
        : "Established by the absence of any qualifying documentation in the note.",
      { step: e.step, confidence: e.confidence },
    );
  }

  // Facts about the member come from the book, not from the note. A prescriber
  // asserting a trial is one thing; a paid claim for it is another, and the
  // criteria engine prefers the claim.
  const history = await run.tool(
    "getMemberHistory",
    "Two of these steps are satisfied by claims history rather than by anything the prescriber wrote, so the book has to be read as well as the note.",
    async () => {
      const claims = await prisma.claim.findMany({
        where: { memberId: pa.memberId, dateOfService: { lt: pa.receivedAt } },
        select: { drug: { select: { name: true } } },
        take: 400,
        orderBy: { dateOfService: "desc" },
      });
      return {
        filledDrugNames: [...new Set(claims.map((c) => c.drug.name))].slice(0, 60),
        diagnosisCodes: parseCodes(pa.member.diagnosisCodes),
        ageYears: Math.floor(
          (pa.receivedAt.getTime() - pa.member.dateOfBirth.getTime()) /
            (365.25 * 86_400_000),
        ),
        weightKg: pa.member.weightKg ?? undefined,
      };
    },
    (h) =>
      `${h.filledDrugNames.length} distinct products filled, ${h.diagnosisCodes.length} diagnoses on file.`,
  );

  const answers: Record<string, unknown> = {};
  let condition: string | undefined;
  let specialty: string | undefined;
  for (const e of extracted) {
    if (e.value === null) continue;
    if (e.key === "__condition") condition = String(e.value);
    else if (e.key === "__specialty") specialty = String(e.value);
    else if (e.value === "__none") answers[e.key] = [];
    else if (typeof e.value === "boolean") answers[e.key] = e.value;
    else answers[e.key] = [e.value];
  }

  const facts: PAFacts = {
    condition,
    answers,
    prescriberSpecialty: specialty,
    memberDiagnosisCodes: history.diagnosisCodes,
    memberAgeYears: history.ageYears,
    memberWeightKg: history.weightKg,
    filledDrugNames: history.filledDrugNames,
  };

  const determination = await run.tool(
    "walkCriteria",
    "The answers are filled in. The published tree decides from here, and the agent has no say in it.",
    async () => determinePA(tree, facts),
    (d) =>
      `${d.outcome}${d.decidingStep ? ` at step ${d.decidingStep}` : ""} after ${d.path.length} questions.`,
  );

  // A blank answer only matters where it pushed the traversal towards a
  // denial. Several steps are satisfied by claims history regardless of what
  // the prescriber wrote, and escalating those would send work to a pharmacist
  // that the book had already answered.
  const unresolved = determination.path
    .filter((p) => !p.answer)
    .map((p) => extracted.find((e) => e.step === p.step && e.value === null))
    .find(Boolean);

  const result: IntakeResult = {
    runId: run.id,
    extracted,
    outcome: unresolved ? "Escalated" : determination.outcome,
    decidingStep: determination.decidingStep,
    reason: determination.reason,
    path: determination.path.map((p) => ({
      step: p.step,
      question: p.question,
      answer: p.answer,
      evidence: p.evidence,
    })),
    escalationReason: unresolved
      ? `The note does not establish ${unresolved.label.toLowerCase()}, which step ${unresolved.step} turns on.`
      : undefined,
  };

  // Marked against the answer key, where there is one. The agent is not shown
  // the key and the score does not change what it did.
  if (note.groundTruth) {
    const truth = JSON.parse(note.groundTruth) as Record<string, unknown>;
    let correct = 0;
    let missed = 0;
    let wrong = 0;
    const keys = Object.keys(truth).filter(
      (k) => truth[k] !== undefined && truth[k] !== null,
    );
    for (const k of keys) {
      const got = extracted.find((e) => e.key === k);
      if (!got || got.value === null) missed++;
      else if (String(got.value) === String(truth[k])) correct++;
      else wrong++;
    }
    result.accuracy = { fields: keys.length, correct, missed, wrong };
  }

  if (result.outcome === "Escalated") {
    run.refuse(
      result.escalationReason ?? "A required answer is missing.",
      "An answer the tree turns on is not in the note. Guessing it would put a determination on the record that the document does not support.",
    );
    if (opts.persist !== false) {
      await run.finish(
        "Escalated",
        result.escalationReason ?? "Escalated to a pharmacist.",
      );
    }
    return { run, result };
  }

  const denied = result.outcome === "Denied";
  run.propose({
    subjectType: "PriorAuthorization",
    subjectId: pa.id,
    // A denial carries appeal rights, so it is a different kind of action from
    // recording an answer set, and the registry marks it consequential.
    action: denied ? "record-denial" : "record-answer-set",
    headline: denied
      ? `Criteria not met at step ${determination.decidingStep}. Held for pharmacist signature.`
      : `Answer set complete. Criteria met at step ${determination.decidingStep}; approve for ${determination.approvedDays} days.`,
    rationale: denied
      ? (determination.reason ??
        "The traversal reached a deny outcome on the published form.")
      : `Every question the tree asked was answered from the note, and the traversal reached an approve outcome at step ${determination.decidingStep}.`,
    payload: { answers, condition, specialty, path: result.path },
    confidence: Math.min(
      ...extracted
        .filter((e) => determination.path.some((p) => p.step === e.step))
        .map((e) => e.confidence)
        .concat([0.99]),
    ),
  });

  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      denied
        ? `Answer set filled from the note. Denial at step ${determination.decidingStep} held for a pharmacist.`
        : `Answer set filled from the note. Criteria met at step ${determination.decidingStep}.`,
    );
  }

  return { run, result };
}

/**
 * Writes the chart note that arrived with each prior authorisation request.
 *
 * The engine has always held the facts in structured form, because that is
 * what a criteria tree reads. Real requests do not arrive that way. They
 * arrive as a fax with a letterhead, a patient's history, three unrelated
 * medications, a blood pressure, and the six facts the form needs scattered
 * through the prose in whatever order the prescriber thought of them.
 *
 * This script writes the facts back out in that form, so the intake agent has
 * a genuine reading task, and stores the facts alongside as an answer key that
 * extraction can be marked against. The agent never sees the key.
 *
 * Three deliberate imperfections, because a corpus without them proves
 * nothing:
 *
 *   - some notes state a fact obliquely, in language no cue matches, and those
 *     requests should escalate rather than be guessed at;
 *   - some notes contain a decoy, usually a family history with a number in
 *     it, which a careless reader will extract and a pharmacist will reverse;
 *   - faxes carry light OCR damage, in the parts of the page that do not
 *     matter, exactly as they do in practice.
 */

import { prisma } from "../src/lib/db.js";
import { Rng } from "./seed/population.js";
import { fieldsFor, type NoteField } from "../src/lib/agents/pa-intake/fields.js";


const SLOT: Record<string, "med" | "early" | "middle" | "late" | "assessment"> =
  {
    __condition: "assessment",
    quantityLimitBasis: "med",
    quantityDosingProvided: "med",
    diagnosisProvided: "early",
    diagnosisCriteria: "early",
    phototherapyTrial: "middle",
    topicalTrialDocumented: "middle",
    conventionalTherapyTrial: "middle",
    preferredBiosimilarOrFailure: "middle",
    allAlternativesContraindicated: "late",
    contraindicationsListed: "late",
  };

const PRACTICES: Record<string, { name: string; line: string }[]> = {
  Dermatology: [
    { name: "BADGER DERMATOLOGY ASSOCIATES", line: "1240 Regent Street, Suite 300, Madison WI 53715" },
    { name: "LAKESHORE SKIN AND LASER", line: "8801 N Port Washington Rd, Milwaukee WI 53217" },
    { name: "FOX VALLEY DERMATOLOGY SC", line: "2100 E Capitol Drive, Appleton WI 54911" },
  ],
  Rheumatology: [
    { name: "WISCONSIN ARTHRITIS AND RHEUMATOLOGY", line: "455 Science Drive, Madison WI 53711" },
    { name: "GREAT LAKES RHEUMATOLOGY GROUP", line: "3003 W Good Hope Road, Milwaukee WI 53209" },
  ],
  Gastroenterology: [
    { name: "MIDWEST DIGESTIVE HEALTH", line: "1215 S Main Street, Oshkosh WI 54902" },
  ],
  "Allergy and Immunology": [
    { name: "NORTHWOODS ALLERGY AND ASTHMA", line: "620 Lakeland Avenue, Wausau WI 54403" },
  ],
  Pulmonology: [
    { name: "STATELINE PULMONARY CONSULTANTS", line: "1810 E Racine Street, Janesville WI 53545" },
  ],
  Otolaryngology: [
    { name: "BAY AREA EAR NOSE AND THROAT", line: "515 S Monroe Avenue, Green Bay WI 54301" },
  ],
  "Internal Medicine": [
    { name: "CAPITOL SQUARE INTERNAL MEDICINE", line: "22 N Carroll Street, Madison WI 53703" },
    { name: "RIVER BEND FAMILY MEDICINE", line: "706 Dodge Street, Eau Claire WI 54701" },
  ],
};

/*
 * Pronouns are written as tokens and filled in from the member record. A note
 * that calls the patient "he" in one line and "she" in the next is a thing
 * that happens in real charts, but here it would only be a generator bug, and
 * it is the first thing anyone reading the demo would notice.
 *
 *   {S} She/He   {s} she/he   {P} Her/His   {p} her/his   {o} her/him
 */
const DISTRACTORS = [
  "Blood pressure today 128/76, weight stable since the last visit.",
  "{S} continues on lisinopril 10 mg daily for hypertension, with no recent change.",
  "Seasonal rhinitis is well controlled on cetirizine as needed.",
  "No known drug allergies. Immunisations are up to date, including the shingles series.",
  "Patient works second shift and has had difficulty attending morning appointments.",
  "Tuberculosis screening was negative in the last twelve months; QuantiFERON on file.",
  "Hepatitis B surface antigen negative. Baseline CBC and CMP within normal limits.",
  "{S} reports {p} sleep has improved since the last visit and denies fever or weight loss.",
  "Declines tobacco. Occasional alcohol, roughly two drinks per week.",
  "Discussed the risks of immunosuppression, including infection, and {s} understands them.",
  "Family history is notable for type 2 diabetes in {p} father.",
  "Follow up scheduled in twelve weeks, sooner if there is any adverse reaction.",
  "The patient has been counselled on injection technique and sharps disposal.",
  "Prior insurance was through a spouse's plan; coverage changed in January.",
];

/** Decoys. Each one contains something a careless extractor will latch onto. */
const DECOYS = [
  "{P} mother also has psoriasis, affecting perhaps 30% of {p} body surface, and was treated with methotrexate years ago.",
  "{P} sister was on a biologic for atopic dermatitis and did well; the patient is aware of that history.",
  "{S} asked about phototherapy, which a colleague had recommended, but has not started any sessions.",
];

/** Who writes this request, when the original walk did not record it. */
function specialtyFor(treeId: string | null, condition: string | null): string {
  if (treeId === "pa-adalimumab") return "Rheumatology";
  if (treeId === "pa-dupixent") {
    if (condition?.startsWith("asthma")) return "Allergy and Immunology";
    if (condition?.startsWith("crswnp")) return "Otolaryngology";
    if (condition?.startsWith("eoe")) return "Gastroenterology";
    if (condition?.startsWith("copd")) return "Pulmonology";
    return "Dermatology";
  }
  return "Dermatology";
}

function pronouns(female: boolean) {
  const map: Record<string, string> = female
    ? { S: "She", s: "she", P: "Her", p: "her", o: "her" }
    : { S: "He", s: "he", P: "His", p: "his", o: "him" };
  return (s: string) => s.replace(/\{([SsPpo])\}/g, (_, k: string) => map[k]);
}

const CHANNELS = ["Fax", "Portal", "ePA"] as const;

/** Fax pages come off a machine, and the machine is not careful. */
function faxNoise(line: string, rng: Rng): string {
  if (rng.next() > 0.35) return line;
  return line
    .replace(/\bo\b/g, () => (rng.next() < 0.4 ? "0" : "o"))
    .replace(/rn/g, () => (rng.next() < 0.3 ? "m" : "rn"));
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ageAt(dob: Date, at: Date): number {
  return Math.floor((at.getTime() - dob.getTime()) / (365.25 * 86_400_000));
}

/**
 * Which value of a field a note is describing, read back out of the request as
 * it was actually filed.
 */
function valueOf(
  field: NoteField,
  answers: Record<string, unknown>,
  condition: string | null,
  specialty: string | null,
): string | boolean | null {
  if (field.key === "__condition") return condition;
  if (field.key === "__specialty") return specialty;
  const raw = answers[field.key];
  if (raw === undefined) return null;
  if (field.type === "multi") {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.length === 0 ? "__none" : String(list[0]);
  }
  return raw === true || raw === "yes" ? true : raw === false ? false : null;
}

async function main() {
  const started = Date.now();
  await prisma.clinicalNote.deleteMany();

  const pas = await prisma.priorAuthorization.findMany({
    where: { treeId: { not: null } },
    include: {
      member: {
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          cardholderId: true,
          weightKg: true,
          gender: true,
        },
      },
      drug: { select: { name: true, strength: true } },
      decisionSteps: {
        include: { criteriaStep: { select: { stepNumber: true } } },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });

  console.log(`Writing notes for ${pas.length} requests with a criteria form.`);

  const rows: {
    id: string;
    paId: string;
    receivedAt: Date;
    channel: string;
    author: string;
    body: string;
    groundTruth: string;
  }[] = [];

  let oblique = 0;
  let decoyed = 0;

  for (const [i, pa] of pas.entries()) {
    const rng = new Rng(0x9e37 + i * 2654435761);
    const fields = fieldsFor(pa.treeId!);
    if (fields.length === 0) continue;

    const answers = JSON.parse(pa.questionResponses) as Record<string, unknown>;

    // Condition and specialty were evaluated during the original walk, so the
    // evidence line the engine wrote is where they can be read back from.
    let condition: string | null = null;
    let specialty: string | null = null;
    for (const s of pa.decisionSteps) {
      const m = s.evidence?.match(/Prescriber selected "([^"]+)"/);
      if (m) condition = m[1];
      const sp = s.evidence?.match(/Prescriber specialty is ([A-Za-z ]+?)[.,]/);
      if (sp) specialty = sp[1].trim();
    }
    if (!specialty) {
      // The letterhead has to match the indication. Dupilumab is written by a
      // dermatologist for eczema and by an allergist or an ENT for the airway
      // indications, and a fax from a skin clinic requesting it for asthma is
      // the sort of thing a pharmacist in the room notices immediately.
      specialty = specialtyFor(pa.treeId, condition);
    }

    const truth: Record<string, unknown> = {};
    const sentences: Record<string, string[]> = {
      med: [],
      early: [],
      middle: [],
      late: [],
      assessment: [],
    };

    for (const field of fields) {
      if (field.key === "__specialty") {
        truth[field.key] = specialty;
        continue;
      }
      const value = valueOf(field, answers, condition, specialty);
      if (value === null) continue;
      const spec = field.values.find((v) => v.value === value);
      if (!spec) continue;

      // One note in fifteen says it in language no cue will catch. The answer
      // key still records the fact, so a miss counts against the agent rather
      // than being quietly excused.
      const useOblique =
        spec.saysObliquely && spec.saysObliquely.length > 0 && rng.next() < 0.07;
      const bank =
        (condition ? spec.saysFor?.[condition] : undefined) ?? spec.says;
      const text = useOblique
        ? rng.pick(spec.saysObliquely!)
        : rng.pick(bank);
      if (useOblique) oblique++;

      truth[field.key] = value;
      sentences[SLOT[field.key] ?? "middle"].push(text);
    }
    if (condition) truth.__condition = condition;

    const receivedAt = pa.receivedAt;
    const channel = rng.weighted([...CHANNELS], (c) =>
      c === "Fax" ? 5 : c === "Portal" ? 3 : 2,
    );
    const practice = rng.pick(
      PRACTICES[specialty] ?? PRACTICES["Internal Medicine"],
    );
    const age = ageAt(pa.member.dateOfBirth, receivedAt);
    const she = pa.member.gender
      ? pa.member.gender.toUpperCase().startsWith("F")
      : rng.next() < 0.5;
    const pronoun = she ? "She" : "He";
    const she_ = pronouns(she);

    const noise = (s: string) => (channel === "Fax" ? faxNoise(she_(s), rng) : she_(s));

    const head = [
      practice.name,
      practice.line,
      `Phone (608) 555-0${rng.int(100, 199)}  ·  Fax (608) 555-0${rng.int(200, 299)}`,
      "",
      channel === "Fax"
        ? `PRIOR AUTHORIZATION REQUEST — RECEIVED BY FAX, PAGE 1 OF ${rng.int(2, 4)}`
        : channel === "Portal"
          ? "PRIOR AUTHORIZATION REQUEST — SUBMITTED VIA PROVIDER PORTAL"
          : "PRIOR AUTHORIZATION REQUEST — ELECTRONIC PA (NCPDP SCRIPT)",
      `Date: ${fmtDate(receivedAt)}`,
      "",
      `Patient: ${pa.member.firstName} ${pa.member.lastName}    DOB: ${fmtDate(pa.member.dateOfBirth)}    Age: ${age}`,
      `Member ID: ${pa.member.cardholderId}    Group: STEELPOTATOES`,
      `Prescriber: ${pa.prescriberName}, MD — ${specialty}`,
      `NPI: ${pa.prescriberNpi}`,
      "",
      `Medication requested: ${pa.drug.name}${pa.drug.strength ? ` ${pa.drug.strength}` : ""}`,
      ...sentences.med.map((s) => `SIG / quantity: ${s}`),
    ];

    const body: string[] = [];
    body.push("", "CLINICAL NOTE", "");
    body.push(
      noise(
        `${pa.member.firstName} ${pa.member.lastName} is a ${age}-year-old ${she ? "woman" : "man"} followed in this clinic since ${receivedAt.getUTCFullYear() - rng.int(1, 6)}. ${pronoun} returns today for reassessment and we discussed advancing therapy.`,
      ),
    );

    const middle: string[] = [
      ...sentences.early,
      ...sentences.middle,
      ...sentences.late,
    ];
    const filler = [
      ...Array.from({ length: rng.int(3, 5) }, () => rng.pick(DISTRACTORS)),
    ];

    // A decoy only goes in where the true answer is absent or negative, so the
    // note is misleading rather than contradictory: a careless reader finds a
    // fact that is in the note but not about this patient.
    const decoyEligible =
      truth.diagnosisCriteria === "__none" ||
      truth.phototherapyTrial === false ||
      truth.topicalTrialDocumented === false ||
      truth.conventionalTherapyTrial === false;
    if (decoyEligible && rng.next() < 0.28) {
      filler.push(rng.pick(DECOYS));
      decoyed++;
    }

    const interleaved: string[] = [];
    const pool = [...middle];
    const fill = [...new Set(filler)];
    while (pool.length || fill.length) {
      if (pool.length && (fill.length === 0 || rng.next() < 0.62)) {
        interleaved.push(pool.shift()!);
      } else if (fill.length) {
        interleaved.push(noise(fill.shift()!));
      }
    }
    body.push(...interleaved);

    if (sentences.assessment.length > 0) {
      body.push("", "ASSESSMENT AND PLAN", "", ...sentences.assessment);
    }
    body.push(
      "",
      noise(
        "I attest that the information provided is accurate and that this therapy is medically necessary for this patient.",
      ),
      `${pa.prescriberName}, MD`,
      specialty,
    );

    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const line of body) {
      if (line === "") {
        if (buf.length) paragraphs.push(buf.join(" "));
        buf = [];
        paragraphs.push("");
      } else if (/^[A-Z ]{6,}$/.test(line)) {
        if (buf.length) paragraphs.push(buf.join(" "));
        buf = [];
        paragraphs.push(line);
      } else {
        buf.push(line);
        if (buf.length >= 3) {
          paragraphs.push(buf.join(" "));
          buf = [];
        }
      }
    }
    if (buf.length) paragraphs.push(buf.join(" "));

    rows.push({
      id: `note-${pa.id}`,
      paId: pa.id,
      receivedAt,
      channel,
      author: `${pa.prescriberName}, MD`,
      // Substituted once more over the whole note, so a token in a criteria
      // sentence cannot reach the page as literal braces.
      body: she_(
        [...head, ...paragraphs].join("\n").replace(/\n{3,}/g, "\n\n"),
      ),
      groundTruth: JSON.stringify(truth),
    });
  }

  for (let i = 0; i < rows.length; i += 200) {
    await prisma.clinicalNote.createMany({ data: rows.slice(i, i + 200) });
  }

  console.log(
    `Wrote ${rows.length} notes in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  console.log(
    `  ${oblique} state a fact obliquely; ${decoyed} carry a decoy.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

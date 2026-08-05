/**
 * The prescriber layer.
 *
 * Claims arrived from the generator without a writing prescriber, which is
 * fine for pricing — the contract does not care who wrote the script — and
 * useless for everything clinical. Interaction screening needs to know whether
 * two conflicting drugs came from the same prescriber or from two who cannot
 * see each other's charts. Surveillance needs a prescriber to be an entity
 * with peers before "this one is an outlier" means anything.
 *
 * So this builds a roster and attaches it to the existing book. Assignment is
 * by member and therapeutic class rather than per claim: a member sees the
 * same endocrinologist for insulin all year, which is both realistic and the
 * only way a multi-prescriber signal can mean anything. Scatter prescribers
 * randomly across claims and every member looks like they are doctor shopping.
 */

import { Rng } from "./population";
import { hashString } from "../../src/lib/hash";

/** Specialty roster weights, roughly tracking a commercial book's prescriber mix. */
interface SpecialtySpec {
  name: string;
  /** How many prescribers of this specialty to generate. */
  count: number;
  /** Therapeutic classes this specialty writes for. */
  classes: string[];
  credentials: string[];
}

/**
 * Therapeutic classes come from the formulary's own Medi-Span class names, so
 * these lists are matched against real values rather than invented ones.
 */
const SPECIALTIES: SpecialtySpec[] = [
  {
    name: "Family Medicine",
    count: 210,
    classes: [], // Primary care writes for anything not claimed by a specialist.
    credentials: ["MD", "DO", "NP", "PA-C"],
  },
  {
    name: "Internal Medicine",
    count: 140,
    classes: [],
    credentials: ["MD", "DO", "NP"],
  },
  {
    name: "Endocrinology",
    count: 34,
    classes: [
      "ANTIDIABETICS",
      "ENDOCRINE AND METABOLIC AGENTS - MISC.",
      "THYROID AGENTS",
      "CORTICOSTEROIDS",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Cardiology",
    count: 40,
    classes: [
      "ANTIHYPERTENSIVES",
      "ANTIHYPERLIPIDEMICS",
      "BETA BLOCKERS",
      "CALCIUM CHANNEL BLOCKERS",
      "DIURETICS",
      "ANTIARRHYTHMICS",
      "CARDIOVASCULAR AGENTS - MISC.",
      "ANTICOAGULANTS",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Psychiatry",
    count: 48,
    classes: [
      "ANTIDEPRESSANTS",
      "ANTIPSYCHOTICS/ANTIMANIC AGENTS",
      "ANTIANXIETY AGENTS",
      "ADHD/ANTI-NARCOLEPSY/ANTI-OBESITY/A NOREXIANTS",
      "HYPNOTICS/SEDATIVES/SLEEP DISORDER AGENTS",
    ],
    credentials: ["MD", "DO", "NP"],
  },
  {
    name: "Neurology",
    count: 30,
    classes: [
      "ANTICONVULSANTS",
      "ANTIPARKINSON AGENTS",
      "MIGRAINE PRODUCTS",
      "PSYCHOTHERAPEUTIC AND NEUROLOGICAL AGENTS - MISC.",
      "MUSCULOSKELETAL THERAPY AGENTS",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Rheumatology",
    count: 18,
    classes: ["ANALGESICS - ANTI-INFLAMMATORY", "ANTIARTHRITICS"],
    credentials: ["MD", "DO"],
  },
  {
    name: "Dermatology",
    count: 34,
    classes: ["DERMATOLOGICALS"],
    credentials: ["MD", "DO", "PA-C"],
  },
  {
    name: "Pulmonology",
    count: 22,
    classes: ["ANTIASTHMATIC AND BRONCHODILATOR AGENTS", "ANTIHISTAMINES"],
    credentials: ["MD", "DO"],
  },
  {
    name: "Gastroenterology",
    count: 22,
    classes: [
      "GASTROINTESTINAL AGENTS - MISC.",
      "ULCER DRUGS",
      "ULCER DRUGS/ANTISPASMODICS/ANTICHOLINERGI CS",
      "LAXATIVES",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Oncology",
    count: 20,
    classes: [
      "ANTINEOPLASTICS AND ADJUNCTIVE THERAPIES",
      "HEMATOPOIETIC AGENTS",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Infectious Disease",
    count: 16,
    classes: [
      "ANTIVIRALS",
      "ANTI-INFECTIVE AGENTS - MISC.",
      "CEPHALOSPORINS",
      "ANTIFUNGALS",
      "PENICILLINS",
      "MACROLIDES",
      "QUINOLONES",
      "TETRACYCLINES",
      "SULFONAMIDES",
    ],
    credentials: ["MD", "DO"],
  },
  {
    name: "Pain Management",
    count: 14,
    classes: ["ANALGESICS - OPIOID"],
    credentials: ["MD", "DO"],
  },
  {
    name: "Ophthalmology",
    count: 20,
    classes: ["OPHTHALMIC AGENTS"],
    credentials: ["MD", "DO"],
  },
  {
    name: "Obstetrics and Gynecology",
    count: 30,
    classes: ["CONTRACEPTIVES", "ESTROGENS", "PROGESTINS", "VAGINAL PRODUCTS"],
    credentials: ["MD", "DO", "NP", "CNM"],
  },
  {
    name: "Urology",
    count: 14,
    classes: [
      "URINARY ANTISPASMODICS",
      "GENITOURINARY AGENTS - MISCELLANEOUS",
      "ANDROGENS-ANABOLIC",
    ],
    credentials: ["MD", "DO"],
  },
];

const FIRST_NAMES = [
  "Anita", "Marcus", "Priya", "David", "Elena", "James", "Sofia", "Robert",
  "Grace", "Daniel", "Nadia", "Thomas", "Claire", "Samuel", "Leah", "Victor",
  "Maya", "Gregory", "Hannah", "Alan", "Rosa", "Peter", "Ingrid", "Omar",
  "Beatrice", "Nathan", "Yuki", "Franklin", "Adaeze", "Stefan", "Camille",
  "Isaac", "Lydia", "Malik", "Teresa", "Vincent", "Amara", "Julian", "Noor",
  "Colin", "Fiona", "Rajiv", "Helena", "Curtis", "Simone", "Andre", "Delia",
  "Bruno", "Iris", "Warren",
];

const LAST_NAMES = [
  "Rao", "Whitfield", "Nakamura", "Okafor", "Lindstrom", "Vasquez", "Brennan",
  "Achebe", "Kowalczyk", "Devereux", "Halvorsen", "Mbeki", "Castellano",
  "Thornbury", "Nguyen", "Abramson", "Fitzwilliam", "Oyelaran", "Petrov",
  "Kaufmann", "Delacroix", "Sandoval", "Wexler", "Attenborough", "Ferreira",
  "Bhattacharya", "Lindqvist", "Moreau", "Tanaka", "Underhill", "Cassidy",
  "Novotny", "Aguirre", "Zielinski", "Hargrove", "Kimura", "Sorensen",
  "Villanueva", "Beaumont", "Ashworth", "Cirillo", "Dumont", "Eriksen",
  "Falconer", "Gutierrez", "Hollingsworth", "Ivanova", "Jaworski", "Kristensen",
  "Lachance",
];

const CITIES: Array<[string, string]> = [
  ["Madison", "WI"], ["Milwaukee", "WI"], ["Green Bay", "WI"],
  ["Kenosha", "WI"], ["Racine", "WI"], ["Appleton", "WI"],
  ["Waukesha", "WI"], ["Eau Claire", "WI"], ["Oshkosh", "WI"],
  ["Janesville", "WI"], ["La Crosse", "WI"], ["Sheboygan", "WI"],
  ["Wauwatosa", "WI"], ["Fond du Lac", "WI"], ["Wausau", "WI"],
];

export interface GeneratedPrescriber {
  npi: string;
  firstName: string;
  lastName: string;
  credential: string;
  specialty: string;
  city: string;
  state: string;
  seededCase: string | null;
}

/**
 * A real NPI is ten digits whose last is a Luhn check digit computed over the
 * nine-digit base prefixed with 80840, the NPI issuer prefix. Getting this
 * right costs nothing and means anyone in the room who validates one of these
 * against a checker finds a well-formed number rather than a placeholder.
 */
export function npiCheckDigit(base9: string): number {
  const digits = `80840${base9}`.split("").map(Number);
  let sum = 0;
  // Luhn doubles every second digit from the right of the full prefixed string.
  for (let i = digits.length - 1, alt = true; i >= 0; i--, alt = !alt) {
    let d = digits[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

function makeNpi(rng: Rng, used: Set<string>): string {
  for (;;) {
    // NPIs begin with 1 or 2.
    const base = `${rng.pick([1, 2])}${String(rng.int(0, 99_999_999)).padStart(8, "0")}`;
    const npi = `${base}${npiCheckDigit(base)}`;
    if (!used.has(npi)) {
      used.add(npi);
      return npi;
    }
  }
}

export interface PrescriberRoster {
  prescribers: GeneratedPrescriber[];
  /** Therapeutic class to the NPIs of specialists who write for it. */
  byClass: Map<string, string[]>;
  /** NPIs of primary care prescribers, who write for anything. */
  primaryCare: string[];
  bySpecialty: Map<string, string[]>;
}

export function buildRoster(seed = 90_210): PrescriberRoster {
  const rng = new Rng(seed);
  const used = new Set<string>();
  const prescribers: GeneratedPrescriber[] = [];
  const byClass = new Map<string, string[]>();
  const primaryCare: string[] = [];
  const bySpecialty = new Map<string, string[]>();

  for (const spec of SPECIALTIES) {
    for (let i = 0; i < spec.count; i++) {
      const [city, state] = rng.pick(CITIES);
      const p: GeneratedPrescriber = {
        npi: makeNpi(rng, used),
        firstName: rng.pick(FIRST_NAMES),
        lastName: rng.pick(LAST_NAMES),
        credential: rng.pick(spec.credentials),
        specialty: spec.name,
        city,
        state,
        seededCase: null,
      };
      prescribers.push(p);

      const list = bySpecialty.get(spec.name) ?? [];
      list.push(p.npi);
      bySpecialty.set(spec.name, list);

      if (spec.classes.length === 0) {
        primaryCare.push(p.npi);
      } else {
        for (const cls of spec.classes) {
          const byCls = byClass.get(cls) ?? [];
          byCls.push(p.npi);
          byClass.set(cls, byCls);
        }
      }
    }
  }

  return { prescribers, byClass, primaryCare, bySpecialty };
}

export function prescriberDisplayName(p: {
  firstName: string;
  lastName: string;
  credential: string;
}): string {
  return `${p.firstName} ${p.lastName}, ${p.credential}`;
}

/**
 * Choose the writing prescriber for one member and one therapeutic class.
 *
 * A member has a usual primary care prescriber, keyed off their own id so it
 * is stable across the year. Specialist classes go to a specialist most of the
 * time and to primary care the rest, which is how referral actually works and
 * which gives the multi-prescriber detector a believable baseline to sit on.
 */
export function assignPrescriber(
  roster: PrescriberRoster,
  memberSeed: number,
  therapeuticClass: string,
): string {
  const pcp = roster.primaryCare[memberSeed % roster.primaryCare.length];
  const specialists = roster.byClass.get(therapeuticClass);
  if (!specialists || specialists.length === 0) return pcp;

  // Stable per member and class, so the same pairing recurs all year.
  const rng = new Rng(memberSeed ^ hashString(therapeuticClass));
  if (rng.bool(0.35)) return pcp;
  return specialists[rng.int(0, specialists.length - 1)];
}

// Re-exported from its old home so the seed scripts that import it from here
// keep working. The implementation moved to src/lib/hash.ts when the NPS model
// needed the same stable hash at request time; two copies of it would have been
// two things to keep identical, and a drift between them would silently change
// every prescriber pairing in the book.
export { hashString };

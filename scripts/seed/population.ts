/**
 * Synthetic membership.
 *
 * Calibrated against ET-8933, the published pharmacy benefits fact sheet:
 * 211,424 commercial participants filled 3,062,138 prescriptions costing
 * $321,911,357 in 2025. That is 14.5 prescriptions and $1,523 per participant
 * per year, and those two numbers are what the generated population is tuned
 * to reproduce at a smaller scale.
 *
 * Utilization is not uniform, and modeling it as uniform would make every
 * downstream report wrong in the same direction. Real pharmacy spend is
 * extremely concentrated: a small share of members drives most of the cost,
 * almost entirely through specialty drugs.
 */

export interface UtilizationProfile {
  id: string;
  label: string;
  /** Share of the population. */
  share: number;
  /** Prescriptions per year, before family and channel effects. */
  scriptsPerYear: [number, number];
  /** Probability that this member uses a specialty drug. */
  specialtyProbability: number;
  /** Number of distinct chronic maintenance drugs. */
  chronicDrugs: [number, number];
  diagnosisPool: string[];
}

export const PROFILES: UtilizationProfile[] = [
  {
    id: "healthy",
    label: "Occasional user",
    share: 0.42,
    scriptsPerYear: [0, 4],
    specialtyProbability: 0,
    chronicDrugs: [0, 1],
    diagnosisPool: ["J06", "L03", "M25"],
  },
  {
    id: "chronic-single",
    label: "Single chronic condition",
    share: 0.28,
    scriptsPerYear: [8, 16],
    specialtyProbability: 0.01,
    chronicDrugs: [1, 2],
    diagnosisPool: ["I10", "E78", "F32", "J45", "K21"],
  },
  {
    id: "chronic-multi",
    label: "Multiple chronic conditions",
    share: 0.275,
    scriptsPerYear: [18, 38],
    specialtyProbability: 0.005,
    chronicDrugs: [3, 6],
    diagnosisPool: ["I10", "E11", "E78", "F32", "J44", "N18", "I48", "M17"],
  },
  {
    // Roughly 1% of members. ET-8933 implies specialty is around 1% of
    // prescriptions and about half of total cost, and that concentration is
    // the single most important thing to get right: a specialty share that is
    // too high makes every per-member cost figure meaningless.
    id: "specialty",
    label: "Specialty therapy",
    share: 0.012,
    scriptsPerYear: [16, 30],
    specialtyProbability: 0.92,
    chronicDrugs: [2, 5],
    diagnosisPool: ["L40", "M05", "K50", "L20", "G35", "J45", "K51", "M06"],
  },
];

/** Diagnosis descriptions used by the member service agent when explaining. */
export const ICD10_LABELS: Record<string, string> = {
  I10: "Essential hypertension",
  E11: "Type 2 diabetes mellitus",
  E78: "Disorders of lipoprotein metabolism",
  F32: "Major depressive disorder, single episode",
  J45: "Asthma",
  J44: "Chronic obstructive pulmonary disease",
  K21: "Gastro-esophageal reflux disease",
  N18: "Chronic kidney disease",
  I48: "Atrial fibrillation",
  M17: "Osteoarthritis of knee",
  L40: "Psoriasis",
  M05: "Rheumatoid arthritis with rheumatoid factor",
  M06: "Other rheumatoid arthritis",
  K50: "Crohn's disease",
  K51: "Ulcerative colitis",
  L20: "Atopic dermatitis",
  G35: "Multiple sclerosis",
  J06: "Acute upper respiratory infection",
  L03: "Cellulitis",
  M25: "Other joint disorder",
};

const FIRST_NAMES_F = ["Mary","Patricia","Jennifer","Linda","Barbara","Susan","Jessica","Sarah","Karen","Nancy","Lisa","Margaret","Betty","Sandra","Ashley","Kimberly","Emily","Donna","Michelle","Carol","Amanda","Melissa","Deborah","Stephanie","Rebecca","Laura","Sharon","Cynthia","Kathleen","Amy","Angela","Anna","Brenda","Pamela","Nicole","Katherine","Samantha","Christine","Rachel","Heather"];
const FIRST_NAMES_M = ["James","Robert","John","Michael","David","William","Richard","Joseph","Thomas","Charles","Christopher","Daniel","Matthew","Anthony","Mark","Donald","Steven","Paul","Andrew","Joshua","Kenneth","Kevin","Brian","George","Timothy","Ronald","Jason","Edward","Jeffrey","Ryan","Jacob","Gary","Nicholas","Eric","Jonathan","Stephen","Larry","Justin","Scott","Brandon"];
const LAST_NAMES = ["Anderson","Johnson","Miller","Schmidt","Meyer","Wagner","Becker","Schultz","Hoffman","Zimmerman","Krueger","Bauer","Larson","Olson","Nelson","Peterson","Hansen","Christensen","Jensen","Knutson","Bergstrom","Lindquist","Novak","Kowalski","Zielinski","Wojcik","Kaminski","Lewandowski","Dabrowski","Nowak","Walsh","Murphy","Kelly","O'Brien","Sullivan","Brennan","Fitzgerald","Doyle","Reilly","Byrne","Vang","Xiong","Yang","Her","Lor","Thao","Chang","Moua","Garcia","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Perez","Sanchez","Ramirez","Torres","Flores"];

const WI_CITIES: Array<[string, string]> = [
  ["Madison", "53703"], ["Madison", "53711"], ["Madison", "53719"],
  ["Milwaukee", "53202"], ["Milwaukee", "53215"], ["Milwaukee", "53211"],
  ["Green Bay", "54301"], ["Kenosha", "53142"], ["Racine", "53403"],
  ["Appleton", "54911"], ["Waukesha", "53186"], ["Oshkosh", "54901"],
  ["Eau Claire", "54701"], ["Janesville", "53545"], ["La Crosse", "54601"],
  ["Sheboygan", "53081"], ["Wauwatosa", "53226"], ["Fond du Lac", "54935"],
  ["Wausau", "54401"], ["Stevens Point", "54481"],
];

/**
 * Deterministic pseudo-random generator.
 *
 * The population must be identical on every run, otherwise the golden tests
 * that assert specific claim outcomes are meaningless and the demo changes
 * shape between rehearsal and presentation.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: T[], weight: (item: T) => number): T {
    const total = items.reduce((s, i) => s + weight(i), 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= weight(item);
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  /** Sample a few distinct items without replacement. */
  sample<T>(items: T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }
}

export interface GeneratedMember {
  id: string;
  cardholderId: string;
  personCode: string;
  relationshipCode: string;
  subscriberId: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  diagnosisCodes: string[];
  weightKg: number;
  profileId: string;
  benefitPlanId: string;
  coverageTier: string;
  effectiveDate: Date;
  terminationDate: Date | null;
}

export interface PopulationOptions {
  contractCount: number;
  planYear: number;
  seed: number;
  /** Share of contracts enrolled in the HDHP rather than the IYC plan. */
  hdhpShare: number;
}

export function generatePopulation(
  opts: PopulationOptions,
): GeneratedMember[] {
  const rng = new Rng(opts.seed);
  const members: GeneratedMember[] = [];
  const yearStart = new Date(Date.UTC(opts.planYear, 0, 1));

  for (let c = 0; c < opts.contractCount; c++) {
    const cardholderId = `W${String(100_000_000 + c * 7).padStart(9, "0")}`;
    const lastName = rng.pick(LAST_NAMES);
    const [city, zip] = rng.pick(WI_CITIES);
    const street = `${rng.int(100, 9999)} ${rng.pick(["Oak", "Maple", "Washington", "Jefferson", "Lake", "University", "Main", "Park", "Monroe", "Johnson"])} ${rng.pick(["St", "Ave", "Rd", "Blvd", "Dr", "Ln"])}`;
    const plan = rng.bool(opts.hdhpShare) ? "wi-hdhp-2026" : "wi-iyc-2026";

    // Family composition, roughly matching a public-employee population.
    const roll = rng.next();
    const hasSpouse = roll > 0.42;
    const childCount = roll > 0.72 ? rng.int(1, 3) : 0;
    const coverageTier =
      hasSpouse || childCount > 0 ? "Family" : "Individual";

    // Mid-year enrollment and termination, so eligibility rules get exercised.
    const startsMidYear = rng.bool(0.06);
    const endsMidYear = rng.bool(0.05);
    const effectiveDate = startsMidYear
      ? new Date(Date.UTC(opts.planYear, rng.int(1, 8), 1))
      : yearStart;
    const terminationDate = endsMidYear
      ? new Date(Date.UTC(opts.planYear, rng.int(7, 11), 28))
      : null;

    const addPerson = (
      personCode: string,
      relationshipCode: string,
      gender: string,
      ageMin: number,
      ageMax: number,
    ) => {
      const profile = rng.weighted(PROFILES, (p) => p.share);
      const age = rng.int(ageMin, ageMax);
      const dob = new Date(
        Date.UTC(
          opts.planYear - age,
          rng.int(0, 11),
          rng.int(1, 28),
        ),
      );
      const dxCount =
        profile.id === "healthy" ? rng.int(0, 1) : rng.int(1, 3);
      const diagnosisCodes = rng.sample(profile.diagnosisPool, dxCount);
      const first =
        gender === "F" ? rng.pick(FIRST_NAMES_F) : rng.pick(FIRST_NAMES_M);

      members.push({
        id: `mbr-${cardholderId}-${personCode}`,
        cardholderId,
        personCode,
        relationshipCode,
        subscriberId: personCode === "01" ? null : `${cardholderId}-01`,
        firstName: first,
        lastName,
        dateOfBirth: dob,
        gender,
        addressLine1: street,
        city,
        state: "WI",
        zip,
        phone: `608${rng.int(2000000, 9999999)}`,
        email: `${first.toLowerCase()}.${lastName.toLowerCase().replace(/'/g, "")}@example.wi.gov`,
        diagnosisCodes,
        weightKg: Math.round((gender === "F" ? 68 : 84) + rng.next() * 34 - 12),
        profileId: profile.id,
        benefitPlanId: plan,
        coverageTier,
        effectiveDate,
        terminationDate,
      });
    };

    const subscriberGender = rng.bool(0.52) ? "F" : "M";
    addPerson("01", "1", subscriberGender, 24, 68);
    if (hasSpouse) {
      addPerson("02", "2", subscriberGender === "F" ? "M" : "F", 24, 68);
    }
    for (let k = 0; k < childCount; k++) {
      addPerson(
        String(k + 3).padStart(2, "0"),
        "3",
        rng.bool(0.5) ? "F" : "M",
        0,
        25,
      );
    }
  }

  return members;
}

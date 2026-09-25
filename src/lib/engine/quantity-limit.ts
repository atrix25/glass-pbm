/**
 * Quantity limits, and the units they are written in.
 *
 * A formulary writes limits in whatever noun the clinician thinks in: four
 * capsules a day, two injections per twenty-eight days, twelve tubes a year,
 * one ring a year, a hundred and eighty days of nicotine gum per plan year.
 * A claim, meanwhile, arrives carrying NCPDP field 442-E7, quantity dispensed,
 * in metric decimal units — capsules as a count, cream as grams, solution as
 * millilitres.
 *
 * Those are not the same measurement, and an engine that treats them as the
 * same measurement produces confident nonsense. Comparing a sixty-gram tube of
 * Opzelura against a limit of "twelve tubes per year" as though both were
 * numbers on the same scale says the member has used sixty of their twelve and
 * refuses the fill. The refusal cites a real limit, prints a real number, and
 * is wrong.
 *
 * So a limit here carries three things rather than two: how much, over what
 * period, and *of what*. The unit decides how the comparison is made:
 *
 *   dispensing-unit  the limit is in the units the claim is billed in, so the
 *                    two can be compared directly
 *   package          the limit counts packages, and needs the package size
 *                    before it means anything in billed units
 *   days-supply      the limit is on cumulative days of therapy, not on any
 *                    quantity at all
 *   fill-count       the limit is on the number of fills
 *
 * And when a limit cannot be evaluated — a package count against a drug whose
 * package size was never established — the answer is "not enforceable", said
 * out loud, rather than a guess in either direction. Silently ignoring it is
 * how Navitus paid Vascepa above its own four-a-day limit for years. Guessing
 * against the member is worse: it denies real people real medicine on a unit
 * conversion nobody checked.
 */

/** What the limit's quantity counts. */
export type QuantityLimitBasis =
  | "dispensing-unit"
  | "package"
  | "days-supply"
  | "fill-count";

export interface QuantityLimit {
  /** The number as printed. */
  quantity: number;
  /** The noun as printed: "caps", "tubes", "days", "fills". */
  unit: string | null;
  basis: QuantityLimitBasis;
  /**
   * The period in days, or null when the limit is written per fill and so has
   * no period of its own.
   */
  periodDays: number | null;
  /** The clause as printed, for citation. */
  rawText: string | null;
}

/**
 * What kind of thing a noun counts.
 *
 * Finer than the basis, because two limits can both be in billable units and
 * still not be comparable to the same claim: "30 caps" and "30 gm" are both
 * dispensing-unit limits, and only one of them means anything against a drug
 * billed by the gram.
 */
export type UnitKind =
  | "count"
  | "gram"
  | "milliliter"
  | "package"
  | "days"
  | "fills";

/*
 * Nouns that name a package rather than a billable unit.
 *
 * The distinction is physical: you can dispense part of a package, and the
 * claim is billed for the part, not the package. A limit of two tubes is a
 * limit on how much cream, expressed in the container it arrives in.
 */
const PACKAGE_UNITS = new Set([
  "tube",
  "tubes",
  "ring",
  "rings",
  "kit",
  "kits",
  "pen",
  "pens",
  "inhaler",
  "inhalers",
  "pack",
  "packs",
  "package",
  "packages",
  "box",
  "boxes",
  "bottle",
  "bottles",
  "vial",
  "vials",
  "carton",
  "cartons",
  "canister",
  "canisters",
  "device",
  "devices",
  "jar",
  "jars",
  "tub",
  "tubs",
  "pump",
  "pumps",
  "applicator",
  "applicators",
]);

/**
 * Nouns that count discrete things a claim is billed for one at a time.
 *
 * Listed rather than inferred, because the failure mode of guessing is a wrong
 * denial. A noun in none of these lists is left unclassified and its limit is
 * not enforced, which is the only safe default: an unrecognised unit means the
 * document said something this code has not been taught to read, and the
 * coverage report says so by name.
 */
const COUNT_UNITS = new Set([
  "tab",
  "tabs",
  "tablet",
  "tablets",
  "cap",
  "caps",
  "capsule",
  "capsules",
  "each",
  "ea",
  "unit",
  "units",
  "iu",
  "patch",
  "patches",
  "lozenge",
  "lozenges",
  "troche",
  "troches",
  "spray",
  "sprays",
  "drop",
  "drops",
  "supp",
  "supps",
  "suppository",
  "suppositories",
  "film",
  "films",
  "strip",
  "strips",
  "packet",
  "packets",
  "wafer",
  "wafers",
  "syringe",
  "syringes",
  // A prefilled injection is billed as the thing itself, one per injection.
  "inj",
  "injection",
  "injections",
  "implant",
  "implants",
  "chew",
  "chews",
  "piece",
  "pieces",
  "tablet",
  // Diabetes and delivery hardware, dispensed and billed as discrete items.
  "sensor",
  "sensors",
  "receiver",
  "receivers",
  "reader",
  "readers",
  "transmitter",
  "transmitters",
  "pod",
  "pods",
  "button",
  "buttons",
  "cartridge",
  "cartridges",
  "ampule",
  "ampules",
  "ampoule",
  "ampoules",
  "condom",
  "condoms",
  // A unit-dose product — a vaccine, a rescue spray, a rectal gel syringe — is
  // billed as one thing per dose.
  "dose",
  "doses",
  "inhalation",
  "inhalations",
]);

const GRAM_UNITS = new Set(["gm", "gms", "g", "gram", "grams"]);
const ML_UNITS = new Set([
  "ml",
  "mls",
  "milliliter",
  "milliliters",
  "millilitre",
  "millilitres",
  "cc",
  "tsp",
]);
const DAYS_UNITS = new Set(["day", "days"]);
const FILL_UNITS = new Set(["fill", "fills", "rx", "prescription", "prescriptions"]);

/** Classify the noun a limit's quantity is counted in. */
export function unitKind(unit: string | null | undefined): UnitKind | null {
  if (!unit) return null;
  const u = unit.toLowerCase().replace(/[^a-z]/g, "");
  if (DAYS_UNITS.has(u)) return "days";
  if (FILL_UNITS.has(u)) return "fills";
  if (PACKAGE_UNITS.has(u)) return "package";
  if (GRAM_UNITS.has(u)) return "gram";
  if (ML_UNITS.has(u)) return "milliliter";
  if (COUNT_UNITS.has(u)) return "count";
  return null;
}

export function basisForUnit(
  unit: string | null | undefined,
): QuantityLimitBasis | null {
  switch (unitKind(unit)) {
    case "days":
      return "days-supply";
    case "fills":
      return "fill-count";
    case "package":
      return "package";
    case "count":
    case "gram":
    case "milliliter":
      return "dispensing-unit";
    default:
      return null;
  }
}

/**
 * The billing unit an NDC is priced and dispensed in, reduced to the same three
 * kinds a limit's noun reduces to.
 */
function billingKind(unitOfMeasure: string): UnitKind {
  switch ((unitOfMeasure || "EA").toUpperCase()) {
    case "GM":
    case "G":
      return "gram";
    case "ML":
      return "milliliter";
    default:
      return "count";
  }
}

/** Normalize a period phrase to a length in days; null means "per fill". */
export function periodInDays(
  count: string | number | undefined,
  unit: string,
): number | null {
  const n =
    count === undefined
      ? 1
      : typeof count === "number"
        ? count
        : parseInt(count, 10) || 1;
  switch (unit.toLowerCase().trim()) {
    case "day":
    case "days":
      return n;
    case "week":
    case "weeks":
      return n * 7;
    case "month":
    case "months":
      return n * 30;
    case "year":
    case "years":
    case "plan year":
    case "plan years":
      return 365;
    case "lifetime":
      return 36_500;
    case "fill":
    case "fills":
      // A per-fill limit has no period. Calling it thirty days would make it a
      // rate, and a rate is exactly what it is not.
      return null;
    default:
      return n;
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface QuantityLimitFill {
  dateOfService: Date;
  quantityDispensed: number;
  daysSupply: number;
}

export interface QuantityLimitRequest {
  limit: QuantityLimit;
  quantityDispensed: number;
  daysSupply: number;
  dateOfService: Date;
  /** Units in one package, from the NDC. */
  packageSize: number;
  /** The billing unit from the NDC: EA, GM, ML. */
  unitOfMeasure: string;
  /** How much each named container holds, from the FDA NDC Directory. */
  packageContainers?: Record<string, number> | null;
  /** This member's earlier fills of this same drug, in any order. */
  priorFills: QuantityLimitFill[];
  /** Where a plan-year window starts, for limits written per plan year. */
  planYearStart: Date;
}

export type QuantityLimitVerdict =
  | {
      enforceable: false;
      /** Why the limit could not be evaluated, in words a reviewer can act on. */
      reason: string;
      basis: QuantityLimitBasis | null;
    }
  | {
      enforceable: true;
      withinLimit: boolean;
      basis: QuantityLimitBasis;
      /** How much this fill is allowed to use, in the unit compared. */
      allowed: number;
      /** How much it would use, counting history where the limit is cumulative. */
      used: number;
      /** The unit the comparison was made in. */
      comparedIn: string;
      /** The window the comparison covered, for the trace. */
      window: string;
    };

/**
 * Container nouns a formulary uses for "the package as dispensed".
 *
 * "One pack per 28 days" against a product the FDA describes as a carton
 * holding one syringe means one carton. The plan is not naming a container the
 * manufacturer recognises; it is naming the thing that leaves the shelf.
 */
const GENERIC_PACKAGE_NOUNS = new Set([
  "PACK",
  "PACKAGE",
  "CARTON",
  "BOX",
  "KIT",
  "CO-PACK",
]);

/**
 * Where a formulary's noun and the FDA's noun are the same object.
 *
 * A judgement table rather than a fuzzy match, on the same principle as the
 * corporate roll-up in the labeler ingest: every row is a claim someone can
 * read and disagree with. A prefilled pen is a syringe in FDA vocabulary and a
 * pen in every other document; an aerosol can and a nasal spray bottle are the
 * same container with two names. Nothing is matched on spelling similarity,
 * because "vial" and "via" would pass that and mean nothing.
 */
const CONTAINER_SYNONYMS: Record<string, string[]> = {
  PEN: ["SYRINGE", "INJECTOR", "AUTOINJECTOR"],
  SYRINGE: ["PEN", "INJECTOR", "AUTOINJECTOR"],
  BOTTLE: ["CAN", "CANISTER", "CONTAINER", "VIAL"],
  CAN: ["BOTTLE", "CANISTER"],
  INHALER: ["CANISTER", "CAN", "CONTAINER", "INHALER"],
  APPLICATOR: ["TUBE", "SYRINGE"],
  TUBE: ["APPLICATOR"],
  VIAL: ["CONTAINER", "AMPULE", "AMPOULE"],
  AMPULE: ["VIAL", "AMPOULE", "CONTAINER"],
  RING: ["CONTAINER", "POUCH"],
};

/** Reduce a container noun to the form the package map is keyed by. */
export function containerKey(noun: string): string {
  return noun
    .split(",")[0]
    .replace(/[^A-Za-z ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/S$/, "");
}

export interface PackageFacts {
  /** How much each named container holds, in unitOfMeasure. */
  containers?: Record<string, number> | null;
  /** The outermost package's contents, which is the package as dispensed. */
  packageSize?: number | null;
  unitOfMeasure?: string | null;
}

export interface PackageConversion {
  /** Billable units in one of the container the limit names. */
  unitsPerPackage: number;
  /** How that was established, for the trace. */
  basis: string;
}

/**
 * How many billable units are in one of whatever the limit counts.
 *
 * Four ways to know, in descending order of directness, and null when none of
 * them applies. Returning null is a real answer: it is what stops a limit in
 * tubes being enforced against a quantity in grams.
 */
export function resolvePackage(
  limitUnit: string | null,
  drug: PackageFacts,
): PackageConversion | null {
  const uom = (drug.unitOfMeasure || "EA").toUpperCase();
  const billedByTheEach = uom === "EA" || uom === "EACH" || uom === "";
  const key = containerKey(limitUnit ?? "");
  const containers = drug.containers ?? null;

  // The FDA names this exact container and says how much it holds.
  if (containers && key && containers[key] !== undefined) {
    if (billedByTheEach) {
      /*
       * A drug priced per each, whose package the FDA describes as containers of
       * a measured volume, is priced per container: NADAC lists cyclosporine
       * ophthalmic emulsion per EA, and the each is one vial. So the limit's
       * count is already in billable units.
       */
      return { unitsPerPackage: 1, basis: `one ${key} is one billable unit` };
    }
    return {
      unitsPerPackage: containers[key],
      basis: `FDA NDC Directory: 1 ${key} holds ${containers[key]} ${uom}`,
    };
  }

  // The formulary named the dispensed package rather than a container.
  if (GENERIC_PACKAGE_NOUNS.has(key)) {
    if (billedByTheEach) {
      return { unitsPerPackage: 1, basis: "one dispensed package is one billable unit" };
    }
    /*
     * A size of one is only suspicious when nothing sourced it. Where the
     * container map is present the figure came from the FDA directory, and a
     * one-millilitre prefilled syringe is a real package rather than an
     * unpopulated column.
     */
    const sourced = containers !== null;
    if (drug.packageSize && (sourced || drug.packageSize > 1)) {
      return {
        unitsPerPackage: drug.packageSize,
        basis: `FDA NDC Directory: the dispensed package holds ${drug.packageSize} ${uom}`,
      };
    }
  }

  // The two documents call the same container different things.
  if (containers && key) {
    for (const alias of CONTAINER_SYNONYMS[key] ?? []) {
      const holds = containers[alias];
      if (holds === undefined) continue;
      if (billedByTheEach) {
        return {
          unitsPerPackage: 1,
          basis: `one ${alias} — what the formulary calls a ${key.toLowerCase()} — is one billable unit`,
        };
      }
      return {
        unitsPerPackage: holds,
        basis: `FDA NDC Directory: 1 ${alias}, which the formulary calls a ${key.toLowerCase()}, holds ${holds} ${uom}`,
      };
    }
  }

  /*
   * A drug billed by the each with no package data at all: one of whatever the
   * limit counts is one billable unit, because the each is the unit the
   * pharmacy dispenses and the plan counts. This is the only inference made
   * without a source, and it is safe in the direction that matters — it cannot
   * turn a compliant fill into a refused one the way a grams-versus-tubes
   * comparison can.
   */
  if (billedByTheEach) {
    return { unitsPerPackage: 1, basis: "the drug is billed by the each" };
  }

  return null;
}

const TOLERANCE = 1.0001;

export function evaluateQuantityLimit(
  req: QuantityLimitRequest,
): QuantityLimitVerdict {
  const { limit } = req;

  if (!(limit.quantity > 0)) {
    return {
      enforceable: false,
      reason:
        "The formulary codes a quantity limit for this drug but the printed clause did not yield a number, so there is nothing to compare against.",
      basis: limit.basis,
    };
  }

  switch (limit.basis) {
    case "days-supply":
      return cumulative(req, req.daysSupply, (f) => f.daysSupply, "days supply");

    case "fill-count":
      return cumulative(req, 1, () => 1, "fills");

    case "dispensing-unit": {
      /*
       * Both sides are in billable units, which is not the same as both sides
       * being in the *same* billable unit. A limit of thirty capsules against a
       * drug the pharmacy bills by the gram is two different measurements
       * wearing the same shape, and comparing them is how a member gets refused
       * for exceeding a limit they are nowhere near.
       */
      const wanted = unitKind(limit.unit);
      const billed = billingKind(req.unitOfMeasure);
      if (wanted && wanted !== billed) {
        return {
          enforceable: false,
          reason: `The limit is written in ${limit.unit} and this drug is billed by the ${req.unitOfMeasure.toUpperCase()}. Those count different things, so the limit is reported as a gap rather than enforced on a conversion nobody supplied.`,
          basis: "dispensing-unit",
        };
      }
      return byQuantity(req, limit.quantity, limit.unit ?? "units");
    }

    case "package": {
      const conversion = resolvePackage(limit.unit, {
        containers: req.packageContainers,
        packageSize: req.packageSize,
        unitOfMeasure: req.unitOfMeasure,
      });
      if (conversion === null) {
        return {
          enforceable: false,
          reason: `The limit is written in ${limit.unit ?? "packages"}, this drug is billed by the ${req.unitOfMeasure.toUpperCase()}, and nothing on file says how many ${req.unitOfMeasure.toUpperCase()} are in one. Converting ${limit.quantity} ${limit.unit ?? "packages"} into billable units would be a guess, so the limit is not enforced and is reported as a gap instead.`,
          basis: "package",
        };
      }
      return byQuantity(
        req,
        limit.quantity * conversion.unitsPerPackage,
        req.unitOfMeasure.toUpperCase(),
        conversion.basis,
      );
    }
  }
}

/**
 * A limit on billed quantity.
 *
 * Two shapes, and the difference matters. A limit whose period is no longer
 * than the fill — four a day, thirty per fill — is a rate, and the fill is
 * allowed its own days supply worth. A limit whose period is longer than the
 * fill — twelve tubes a year — is a budget, and prorating it would cap a single
 * fill at one tube when the member is entitled to twelve across the year.
 * Budgets are checked against history; rates are checked against the fill.
 */
function byQuantity(
  req: QuantityLimitRequest,
  allowedUnits: number,
  comparedIn: string,
  note?: string,
): QuantityLimitVerdict {
  const { limit, quantityDispensed, daysSupply } = req;

  if (limit.periodDays === null) {
    return {
      enforceable: true,
      withinLimit: quantityDispensed <= allowedUnits * TOLERANCE,
      basis: limit.basis,
      allowed: allowedUnits,
      used: quantityDispensed,
      comparedIn,
      window: note ? `per fill (${note})` : "per fill",
    };
  }

  if (limit.periodDays <= daysSupply) {
    const perDay = allowedUnits / limit.periodDays;
    const allowedForFill = perDay * daysSupply;
    return {
      enforceable: true,
      withinLimit: quantityDispensed <= allowedForFill * TOLERANCE,
      basis: limit.basis,
      allowed: Number(allowedForFill.toFixed(4)),
      used: quantityDispensed,
      comparedIn,
      window: `${daysSupply} days supply at ${Number(perDay.toFixed(4))} ${comparedIn} per day${note ? ` (${note})` : ""}`,
    };
  }

  return cumulative(
    req,
    quantityDispensed,
    (f) => f.quantityDispensed,
    comparedIn,
    allowedUnits,
    note,
  );
}

/**
 * A limit spent over a period, checked against what the member has already used
 * inside it.
 *
 * The window for a limit written per plan year is the plan year, not a rolling
 * three hundred and sixty-five days, because that is what the document means
 * and because a rolling window would carry last year's fills into this one.
 */
function cumulative(
  req: QuantityLimitRequest,
  thisFill: number,
  ofFill: (f: QuantityLimitFill) => number,
  comparedIn: string,
  allowedOverride?: number,
  note?: string,
): QuantityLimitVerdict {
  const { limit, dateOfService, priorFills, planYearStart } = req;
  const allowed = allowedOverride ?? limit.quantity;
  const period = limit.periodDays ?? 0;

  const annual = period >= 365;
  const windowStart = annual
    ? planYearStart
    : new Date(dateOfService.getTime() - period * 86_400_000);

  /*
   * Upper bound is inclusive of the fill date. Callers put only earlier fills
   * into `priorFills`; a strict `< dateOfService` cut dropped every prior that
   * shared the calendar day and reset cumulative budgets mid-morning.
   */
  const inWindow = priorFills.filter(
    (f) => f.dateOfService >= windowStart && f.dateOfService <= dateOfService,
  );
  const alreadyUsed = inWindow.reduce((sum, f) => sum + ofFill(f), 0);
  const used = alreadyUsed + thisFill;

  return {
    enforceable: true,
    withinLimit: used <= allowed * TOLERANCE,
    basis: limit.basis,
    allowed,
    used: Number(used.toFixed(4)),
    comparedIn,
    window: annual
      ? `plan year to date: ${Number(alreadyUsed.toFixed(4))} already used across ${inWindow.length} earlier fills${note ? ` (${note})` : ""}`
      : `trailing ${period} days: ${Number(alreadyUsed.toFixed(4))} already used across ${inWindow.length} earlier fills${note ? ` (${note})` : ""}`,
  };
}

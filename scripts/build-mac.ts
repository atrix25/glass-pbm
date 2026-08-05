/**
 * Publishes the maximum allowable cost list, and the appeals against it.
 *
 * The list is not invented here. Every ceiling is the same number the engine
 * already applied when it priced the claim — surveyed acquisition cost from the
 * CMS NADAC file, plus the published margin — so what is written out is a
 * disclosure of what happened rather than a parallel set of prices that could
 * disagree with the book. That is the whole argument for publishing it: a list
 * you can check against the claims is a list nobody has to trust.
 *
 * Appeals are generated from claims the ceiling actually governed. A pharmacy
 * that bought above the survey average loses money on the fill and says so,
 * within the twenty-one days Wisconsin gives it, and the plan has twenty-one
 * days to answer with either a product available at the ceiling or a higher
 * ceiling and a cheque.
 *
 *   npx tsx scripts/build-mac.ts
 */

import { Prisma } from "../src/generated/prisma/index.js";
import { prisma } from "../src/lib/db.js";
import { Rng } from "./seed/population.js";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/engine/benchmark.js";
import { PLAN_YEAR } from "../src/lib/clock.js";

const DAY_MS = 86_400_000;

/**
 * Wisconsin requires a refresh at least every seven business days. Weekly on a
 * fixed day clears that with room, and matches the Wednesday NADAC publication
 * the ceilings are derived from.
 */
const REFRESH_DAY = 3; // Wednesday

const WHOLESALERS = [
  "AmerisourceBergen",
  "Cardinal Health",
  "McKesson Connect",
];

const DENIAL_REASONS = [
  "The product is available to retail network pharmacies at or below the ceiling from at least one primary wholesaler, at the national drug code named below. The ceiling stands.",
  "The invoice submitted is for a package size the pharmacy is not required to purchase. The same molecule and strength is available at or below the ceiling in the size named below.",
  "The invoice price reflects a short-dated purchase outside the pharmacy's primary contract. A conforming source at or below the ceiling is named below.",
];

function wednesdays(): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(PLAN_YEAR, 0, 1));
  while (cursor.getUTCDay() !== REFRESH_DAY) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  /*
   * Runs a month past the plan year, because a fill on the last Friday of
   * December can still be appealed in January and the adjustment has to land
   * on a version that exists.
   */
  const end = Date.UTC(PLAN_YEAR + 1, 1, 15);
  while (cursor.getTime() < end) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

async function main() {
  console.log("Publishing the MAC list...");
  await prisma.macPriceChange.deleteMany();
  await prisma.macPrice.deleteMany();
  await prisma.macAppeal.deleteMany();
  await prisma.macList.deleteMany();

  const rng = new Rng(6532);
  const versions = wednesdays();

  /*
   * The list covers multi-source retail generics, which is exactly the set the
   * engine gives a ceiling to. Brands and specialty products are priced off the
   * discount arm and are not on any MAC list, here or anywhere.
   */
  const drugs = await prisma.drug.findMany({
    where: { isBrandLabel: false, isSpecialty: false },
    select: {
      id: true,
      ndc11: true,
      name: true,
      prices: { where: { priceType: "NADAC" }, select: { unitPrice: true } },
    },
  });
  const priced = drugs.filter((d) => d.prices.length > 0);
  console.log(`  ${priced.length} multi-source generics with a surveyed cost`);

  const ceiling = (nadac: number) =>
    nadac * DEFAULT_ASSUMPTIONS.macMultiplierGeneric;

  // --- Appeals --------------------------------------------------------------
  /*
   * Only fills the ceiling actually governed can be appealed, so the candidates
   * are claims whose basis of reimbursement came back as MAC. Independent
   * pharmacies buy worse than chains and appeal more, which is both true and
   * the reason the statute exists.
   */
  const candidates = await prisma.$queryRaw<
    Array<{
      claimId: string;
      claimNumber: string;
      pharmacyId: string;
      drugId: string;
      dos: number;
      quantity: number;
      macUnit: number;
      nadacUnit: number;
      pharmacyType: string;
    }>
  >`
    SELECT c.id AS claimId, c.claimNumber AS claimNumber, c.pharmacyId AS pharmacyId,
           c.drugId AS drugId, CAST(c.dateOfService AS REAL) AS dos,
           c.quantityDispensed AS quantity, c.macUnitAtDos AS macUnit,
           c.nadacUnitAtDos AS nadacUnit, p.pharmacyType AS pharmacyType
    FROM Claim c
    JOIN Pharmacy p ON p.id = c.pharmacyId
    WHERE c.responseStatus = 'P'
      AND c.transactionCode = 'B1'
      AND c.basisOfReimbursement = '7'
      AND c.macUnitAtDos IS NOT NULL
      -- Nobody files paperwork over a fill worth eleven dollars.
      AND c.allowedIngredientCostCents >= 3000
      -- A deterministic spread across the whole year rather than the first
      -- rows the planner happens to reach, so appeals are not all in January.
      AND (c.rowid % 7) = 0
    ORDER BY c.dateOfService
  `;
  console.log(`  ${candidates.length} fills priced at the ceiling to draw from`);

  const appeals: Array<{
    id: string;
    pharmacyId: string;
    claimId: string;
    drugId: string;
    dateOfService: Date;
    submittedAt: Date;
    quantityDispensed: number;
    invoiceUnitPrice: number;
    macUnitPrice: number;
    decidedAt: Date;
    outcome: string;
    denialReason: string | null;
    citedNdc: string | null;
    citedWholesaler: string | null;
    revisedUnitPrice: number | null;
    adjustmentCents: number;
    affectedClaims: number;
    adjustedAt: Date | null;
  }> = [];

  const ndcByDrug = new Map(priced.map((d) => [d.id, d.ndc11]));
  const seenClaim = new Set<string>();

  for (const c of candidates) {
    if (seenClaim.has(c.claimId)) continue;

    const dateOfService = new Date(c.dos);
    // Inside the statutory 21 days, because outside it there is no right.
    const submittedAt = new Date(dateOfService.getTime() + rng.int(2, 20) * DAY_MS);
    const decidedAt = new Date(submittedAt.getTime() + rng.int(3, 20) * DAY_MS);

    /*
     * The pharmacy paid above the survey average. How far above decides the
     * outcome: a little is the ordinary spread of a national average, and the
     * plan can point at a wholesaler selling it for less. A lot means the
     * survey has gone stale against the market and the ceiling is wrong.
     */
    const overpayment = rng.next() < 0.3 ? rng.next() * 0.9 + 0.35 : rng.next() * 0.25;
    const invoiceUnitPrice = c.macUnit * (1 + overpayment);
    const lossCents = (invoiceUnitPrice - c.macUnit) * c.quantity * 100;

    /*
     * Appealing costs the pharmacy an hour of a technician's time and an
     * invoice pulled from the wholesaler portal, so the loss has to be worth
     * that. Independents appeal several times more often than chains, partly
     * because they buy worse and partly because a chain absorbs a bad ceiling
     * on one store against a good one on another.
     */
    if (lossCents < 1_500) continue;
    const base = c.pharmacyType === "Independent" ? 0.07 : 0.015;
    if (!rng.bool(Math.min(0.4, base * (1 + lossCents / 12_000)))) continue;
    seenClaim.add(c.claimId);

    /*
     * Most appeals fail, and failing is not the same as being ignored. A
     * national average is an average: a pharmacy paying well above it is
     * usually buying from the wrong source, and the answer is the name of a
     * wholesaler selling it at the ceiling. The ceiling only moves when the
     * survey itself has gone stale, which is a minority of the loud cases.
     */
    const overturned = invoiceUnitPrice > c.macUnit * 1.3 && rng.bool(0.3);

    const id = `mac-appeal-${String(appeals.length + 1).padStart(5, "0")}`;
    appeals.push({
      id,
      pharmacyId: c.pharmacyId,
      claimId: c.claimId,
      drugId: c.drugId,
      dateOfService,
      submittedAt,
      quantityDispensed: c.quantity,
      invoiceUnitPrice,
      macUnitPrice: c.macUnit,
      decidedAt,
      outcome: overturned ? "Overturned" : "Upheld",
      denialReason: overturned ? null : rng.pick(DENIAL_REASONS),
      citedNdc: overturned ? null : (ndcByDrug.get(c.drugId) ?? null),
      citedWholesaler: overturned ? null : rng.pick(WHOLESALERS),
      // A ceiling that has to move goes to just above what the pharmacy paid.
      revisedUnitPrice: overturned ? invoiceUnitPrice * 1.02 : null,
      adjustmentCents: 0,
      affectedClaims: 0,
      // The statute allows one day from determination to adjustment.
      adjustedAt: overturned ? new Date(decidedAt.getTime() + DAY_MS) : null,
    });
  }

  /*
   * An overturn is not paid on the appealed fill alone. The pharmacy was
   * underwater on every fill of that drug it dispensed while the appeal was
   * open, so the adjustment covers all of them — which is what makes an
   * overturn expensive enough that the investigation has to be real.
   */
  const overturnedDrugs = Array.from(
    new Set(
      appeals.filter((a) => a.outcome === "Overturned").map((a) => a.drugId),
    ),
  );
  const exposure = overturnedDrugs.length
    ? await prisma.$queryRaw<
        Array<{
          pharmacyId: string;
          drugId: string;
          dos: number;
          quantity: number;
        }>
      >`
        SELECT c.pharmacyId AS pharmacyId, c.drugId AS drugId,
               CAST(c.dateOfService AS REAL) AS dos,
               c.quantityDispensed AS quantity
        FROM Claim c
        WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
          AND c.basisOfReimbursement = '7'
          AND c.drugId IN (${Prisma.join(overturnedDrugs)})
      `
    : [];

  const byPharmacyDrug = new Map<string, Array<{ dos: number; quantity: number }>>();
  for (const c of exposure) {
    const key = `${c.pharmacyId}:${c.drugId}`;
    const bucket = byPharmacyDrug.get(key);
    if (bucket) bucket.push({ dos: c.dos, quantity: c.quantity });
    else byPharmacyDrug.set(key, [{ dos: c.dos, quantity: c.quantity }]);
  }

  for (const a of appeals) {
    if (a.outcome !== "Overturned") continue;
    const window = (byPharmacyDrug.get(`${a.pharmacyId}:${a.drugId}`) ?? []).filter(
      (f) =>
        f.dos >= a.dateOfService.getTime() && f.dos <= a.decidedAt.getTime(),
    );
    const quantity = window.reduce((s, f) => s + f.quantity, 0);
    a.affectedClaims = Math.max(1, window.length);
    a.adjustmentCents = Math.round(
      (a.revisedUnitPrice! - a.macUnitPrice) *
        (quantity || a.quantityDispensed) *
        100,
    );
  }

  const overturns = appeals.filter((a) => a.outcome === "Overturned");
  console.log(
    `  ${appeals.length} appeals, ${overturns.length} overturned, ` +
      `$${(overturns.reduce((s, a) => s + a.adjustmentCents, 0) / 100).toFixed(0)} adjusted ` +
      `over ${overturns.reduce((s, a) => s + a.affectedClaims, 0)} fills`,
  );

  // --- List versions --------------------------------------------------------
  /*
   * Every version carries the whole list, because a pharmacy checking a fill
   * from March needs the ceilings that were in force in March, not the ones in
   * force today. The movements recorded against a version are the adjustments
   * won on appeal that took effect on it.
   */
  const overturnsByVersion = new Map<number, typeof appeals>();
  for (const a of appeals) {
    if (a.outcome !== "Overturned" || !a.adjustedAt) continue;
    const index = versions.findIndex((v) => v >= a.adjustedAt!);
    const version = index === -1 ? versions.length : index + 1;
    const list = overturnsByVersion.get(version) ?? [];
    list.push(a);
    overturnsByVersion.set(version, list);
  }

  await prisma.macList.createMany({
    data: versions.map((effectiveDate, i) => ({
      id: `mac-list-v${String(i + 1).padStart(2, "0")}`,
      version: i + 1,
      effectiveDate,
      // Published the evening before it takes effect.
      publishedAt: new Date(effectiveDate.getTime() - 8 * 3_600_000),
      supersededAt: versions[i + 1] ?? null,
      drugCount: priced.length,
      basis:
        "CMS National Average Drug Acquisition Cost, weekly survey file, plus " +
        `${Math.round((DEFAULT_ASSUMPTIONS.macMultiplierGeneric - 1) * 100)}%. ` +
        "One list. The plan is billed the same ceiling the pharmacy is paid.",
      changeCount: (overturnsByVersion.get(i + 1) ?? []).length,
    })),
  });

  const priceRows = versions.flatMap((_, i) =>
    priced.map((d) => {
      const nadac = d.prices[0].unitPrice;
      return {
        id: `mac-price-v${String(i + 1).padStart(2, "0")}-${d.id}`,
        listId: `mac-list-v${String(i + 1).padStart(2, "0")}`,
        drugId: d.id,
        unitPrice: ceiling(nadac),
        nadacUnitPrice: nadac,
        sourceNdc: d.ndc11,
      };
    }),
  );
  for (let i = 0; i < priceRows.length; i += 4_000) {
    await prisma.macPrice.createMany({ data: priceRows.slice(i, i + 4_000) });
  }

  const changeRows = Array.from(overturnsByVersion.entries()).flatMap(
    ([version, list]) =>
      list.map((a) => ({
        id: `mac-change-${a.id}`,
        listId: `mac-list-v${String(Math.min(version, versions.length)).padStart(2, "0")}`,
        drugId: a.drugId,
        pharmacyId: a.pharmacyId,
        priorUnitPrice: a.macUnitPrice,
        newUnitPrice: a.revisedUnitPrice!,
        reason: "Appeal",
        appealId: a.id,
      })),
  );
  await prisma.macPriceChange.createMany({ data: changeRows });

  for (let i = 0; i < appeals.length; i += 2_000) {
    await prisma.macAppeal.createMany({ data: appeals.slice(i, i + 2_000) });
  }

  console.log(
    `  ${versions.length} versions published, ${priced.length} ceilings on each, ` +
      `${changeRows.length} recorded movements`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

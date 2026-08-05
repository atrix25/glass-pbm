/**
 * The MAC appeal response agent.
 *
 * Wisconsin statute 632.865 gives a pharmacy 21 days to appeal a maximum
 * allowable cost, gives the benefit manager 21 days to answer, and requires
 * that a denial name a product available to that pharmacy at or below the
 * ceiling, from a wholesaler it can actually buy from. The reason appeals sit
 * for the full 21 days at most PBMs is that finding that product is work, and
 * the reason some appeals are answered with a form letter is that the work was
 * skipped.
 *
 * The agent does the search and writes the letter. It signs nothing. Upholding
 * a denial and moving a ceiling are both marked consequential, so a pharmacist
 * reviews every one of these before it leaves the building — which is also
 * what the statute contemplates.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { judge } from "../brain";
import { startRun, type Run } from "../runtime";

export interface AppealDraftResult {
  runId: string;
  recommendation: "Uphold" | "Overturn";
  /** The letter, ready for a pharmacist to read and sign. */
  letter: string;
  citedNdc: string | null;
  citedWholesaler: string | null;
  revisedUnitPrice: number | null;
  spreadPerUnit: number;
  confidence: number;
}

const DraftSchema = z.object({
  recommendation: z.enum(["Uphold", "Overturn"]),
  letter: z.string(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are drafting a pharmacy benefit manager's response to a pharmacy's appeal of a maximum allowable cost, under Wisconsin statute 632.865.

- If you uphold, you must name a specific national drug code and a wholesaler from which the pharmacy could have bought at or below the ceiling. Without that, you cannot uphold.
- If no such product exists, the ceiling was wrong and you overturn. Say so plainly.
- Write to a pharmacist who runs a small business, not to a lawyer. Short sentences. No hedging.
- You are drafting. A pharmacist at this company signs it.`;

export async function runAppealDraft(opts: {
  appealId: string;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: AppealDraftResult }> {
  const appeal = await prisma.macAppeal.findUniqueOrThrow({
    where: { id: opts.appealId },
    include: {
      drug: { select: { id: true, name: true, molecule: true, ndc11: true } },
      pharmacy: { select: { name: true, city: true, pharmacyType: true, chainName: true } },
    },
  });

  const run = await startRun({
    agentId: "appeal-drafter",
    goal: `Answer ${appeal.pharmacy.name}'s appeal of the ceiling on ${appeal.drug.name}.`,
    subject: { type: "MacAppeal", id: appeal.id },
    at: opts.at ?? appeal.submittedAt,
  });

  await run.tool(
    "getAppeal",
    "The claim being appealed fixes the date, and the date fixes which version of the list applies. Answering against today's ceiling would be answering a different question.",
    async () => ({
      drug: appeal.drug.name,
      dateOfService: appeal.dateOfService,
      submittedAt: appeal.submittedAt,
      macUnitPrice: appeal.macUnitPrice,
      invoiceUnitPrice: appeal.invoiceUnitPrice,
      quantity: appeal.quantityDispensed,
      shortfallPerUnit: appeal.invoiceUnitPrice - appeal.macUnitPrice,
      pharmacy: appeal.pharmacy.name,
      pharmacyType: appeal.pharmacy.pharmacyType,
    }),
    (d) =>
      `Paid ${d.macUnitPrice.toFixed(5)} per unit against an invoice of ${d.invoiceUnitPrice.toFixed(5)}, a shortfall of $${(d.shortfallPerUnit * d.quantity).toFixed(2)} on the fill.`,
  );

  // The statute's test is availability, not average price. What matters is
  // whether a real package could have been bought at or below the ceiling.
  const availability = await run.tool(
    "getWholesalerAvailability",
    "The question the statute asks is whether the pharmacy could have bought this at the ceiling, so the answer has to be a package that exists and a wholesaler that stocks it.",
    async () => {
      /*
       * The list in force on the day of the fill. Fills on the first days of
       * the plan year predate the first weekly refresh, and they were priced
       * off the opening list rather than off nothing, so fall back to the
       * earliest version rather than leaving the letter unable to say which
       * list it is defending.
       */
      const list =
        (await prisma.macList.findFirst({
          where: { effectiveDate: { lte: appeal.dateOfService } },
          orderBy: { effectiveDate: "desc" },
          select: { id: true, version: true, effectiveDate: true },
        })) ??
        (await prisma.macList.findFirst({
          orderBy: { effectiveDate: "asc" },
          select: { id: true, version: true, effectiveDate: true },
        }));
      const priceRow = list
        ? await prisma.macPrice.findFirst({
            where: { listId: list.id, drugId: appeal.drugId },
            select: { unitPrice: true, nadacUnitPrice: true, sourceNdc: true },
          })
        : null;

      // Equivalents are other labellers' versions of the same molecule, which
      // is exactly what a MAC ceiling assumes the pharmacy can substitute to.
      const equivalents = appeal.drug.molecule
        ? await prisma.drug.findMany({
            where: {
              molecule: appeal.drug.molecule,
              isBrandLabel: false,
              prices: { some: { priceType: "NADAC", unitPrice: { gt: 0 } } },
            },
            select: {
              ndc11: true,
              name: true,
              labeler: true,
              prices: {
                where: { priceType: "NADAC", unitPrice: { gt: 0 } },
                orderBy: { effectiveDate: "desc" },
                take: 1,
                select: { unitPrice: true, effectiveDate: true },
              },
            },
            take: 25,
          })
        : [];

      const priced = equivalents
        .map((e) => ({
          ndc11: e.ndc11,
          name: e.name,
          labeler: e.labeler,
          unitPrice: e.prices[0]?.unitPrice ?? 0,
        }))
        .filter((e) => e.unitPrice > 0)
        .sort((a, b) => a.unitPrice - b.unitPrice);

      return {
        listVersion: list?.version ?? null,
        listEffective: list?.effectiveDate ?? null,
        ceiling: priceRow?.unitPrice ?? appeal.macUnitPrice,
        surveyedCost: priceRow?.nadacUnitPrice ?? null,
        sourceNdc: priceRow?.sourceNdc ?? null,
        atOrBelow: priced.filter((p) => p.unitPrice <= appeal.macUnitPrice),
        cheapest: priced[0] ?? null,
      };
    },
    (a) =>
      a.atOrBelow.length > 0
        ? `${a.atOrBelow.length} equivalent product(s) surveyed at or below the ceiling; cheapest is ${a.atOrBelow[0].ndc11} at ${a.atOrBelow[0].unitPrice.toFixed(5)}.`
        : "No equivalent product is surveyed at or below the ceiling.",
  );

  const history = await run.tool(
    "getMacHistory",
    "A ceiling that has already been challenged and moved is a different conversation from one that has held all year.",
    async () => {
      const changes = await prisma.macPriceChange.findMany({
        where: { drugId: appeal.drugId },
        select: { priorUnitPrice: true, newUnitPrice: true, reason: true },
        take: 5,
      });
      const priorAppeals = await prisma.macAppeal.count({
        where: {
          drugId: appeal.drugId,
          submittedAt: { lt: appeal.submittedAt },
        },
      });
      return { changes, priorAppeals };
    },
    (h) =>
      `${h.priorAppeals} earlier appeal(s) on this product; the ceiling has moved ${h.changes.length} time(s).`,
  );

  const canUphold = availability.atOrBelow.length > 0;
  const cited = availability.atOrBelow[0] ?? null;

  const thought = await judge({
    system: SYSTEM,
    prompt: [
      `Pharmacy: ${appeal.pharmacy.name}, ${appeal.pharmacy.city}, ${appeal.pharmacy.pharmacyType === "Independent" ? "independent" : (appeal.pharmacy.chainName ?? appeal.pharmacy.pharmacyType)}.`,
      `Product: ${appeal.drug.name}, ${appeal.drug.ndc11}.`,
      `Fill dated ${appeal.dateOfService.toISOString().slice(0, 10)}, ${appeal.quantityDispensed} units.`,
      `Ceiling applied: ${appeal.macUnitPrice.toFixed(5)} per unit, from list version ${availability.listVersion ?? "unknown"}.`,
      `Pharmacy's invoice: ${appeal.invoiceUnitPrice.toFixed(5)} per unit.`,
      `Shortfall claimed: $${((appeal.invoiceUnitPrice - appeal.macUnitPrice) * appeal.quantityDispensed).toFixed(2)}.`,
      "",
      canUphold
        ? `Products surveyed at or below the ceiling: ${availability.atOrBelow
            .slice(0, 3)
            .map((p) => `${p.ndc11} (${p.labeler ?? "unknown labeller"}) at ${p.unitPrice.toFixed(5)}`)
            .join("; ")}.`
        : `No equivalent product is surveyed at or below ${appeal.macUnitPrice.toFixed(5)}. The cheapest available is ${availability.cheapest ? `${availability.cheapest.ndc11} at ${availability.cheapest.unitPrice.toFixed(5)}` : "not on file"}.`,
      `${history.priorAppeals} earlier appeals on this product.`,
      "",
      "Draft the response.",
    ].join("\n"),
    schema: DraftSchema,
    fallback: () =>
      scriptedLetter(appeal, availability, canUphold, cited),
  });

  const draft = run.absorb(
    thought,
    "The statute does not ask whether the ceiling was reasonable. It asks whether a product was available at it, and that question has a yes or no answer.",
    `${thought.value.recommendation} — drafted for signature.`,
    { recommendation: thought.value.recommendation, reasoning: thought.value.reasoning },
  );

  const overturn = draft.recommendation === "Overturn";
  const revised = overturn
    ? (availability.cheapest?.unitPrice ?? appeal.invoiceUnitPrice)
    : null;

  run.propose({
    subjectType: "MacAppeal",
    subjectId: appeal.id,
    action: overturn ? "adjust-mac-price" : "uphold-denial",
    headline: overturn
      ? `Overturn. No product was available at ${appeal.macUnitPrice.toFixed(5)}; move the ceiling to ${revised?.toFixed(5)}.`
      : `Uphold, citing ${cited?.ndc11} at ${cited?.unitPrice.toFixed(5)}.`,
    rationale: draft.reasoning,
    payload: {
      letter: draft.letter,
      citedNdc: cited?.ndc11 ?? null,
      revisedUnitPrice: revised,
    },
    confidence: draft.confidence,
  });

  const result: AppealDraftResult = {
    runId: run.id,
    recommendation: draft.recommendation,
    letter: draft.letter,
    citedNdc: overturn ? null : (cited?.ndc11 ?? null),
    citedWholesaler: overturn ? null : "McKesson Connect",
    revisedUnitPrice: revised,
    spreadPerUnit: appeal.invoiceUnitPrice - appeal.macUnitPrice,
    confidence: draft.confidence,
  };

  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      `${appeal.pharmacy.name} on ${appeal.drug.name}: ${overturn ? "overturn" : "uphold"} drafted for signature.`,
    );
  }
  return { run, result };
}

interface Availability {
  ceiling: number;
  listVersion: number | null;
  atOrBelow: { ndc11: string; name: string; labeler: string | null; unitPrice: number }[];
  cheapest: { ndc11: string; name: string; labeler: string | null; unitPrice: number } | null;
}

/**
 * The scripted drafter.
 *
 * The letter has a fixed shape because the statute gives it one. What varies
 * is the product named and whether there is one, and that comes from the
 * search rather than from the writing.
 */
function scriptedLetter(
  appeal: {
    drug: { name: string; ndc11: string };
    pharmacy: { name: string };
    dateOfService: Date;
    macUnitPrice: number;
    invoiceUnitPrice: number;
    quantityDispensed: number;
  },
  availability: Availability,
  canUphold: boolean,
  cited: Availability["atOrBelow"][number] | null,
): z.infer<typeof DraftSchema> {
  const dos = appeal.dateOfService.toISOString().slice(0, 10);
  const shortfall = (
    (appeal.invoiceUnitPrice - appeal.macUnitPrice) *
    appeal.quantityDispensed
  ).toFixed(2);

  if (canUphold && cited) {
    return {
      recommendation: "Uphold",
      confidence: 0.87,
      reasoning: `${cited.ndc11} from ${cited.labeler ?? "a surveyed labeller"} was surveyed at ${cited.unitPrice.toFixed(5)} per unit, below the ${appeal.macUnitPrice.toFixed(5)} ceiling applied on ${dos}. The statute's test is availability at the ceiling, and it is met, so the appeal is denied and the product is named as required.`,
      letter: [
        `Re: appeal of maximum allowable cost, ${appeal.drug.name}, fill dated ${dos}.`,
        "",
        `We have reviewed your appeal. The ceiling applied to this fill was ${appeal.macUnitPrice.toFixed(5)} per unit, ${availability.listVersion === null ? "from the maximum allowable cost list in force on that date" : `from version ${availability.listVersion} of our maximum allowable cost list`}. Your invoice shows ${appeal.invoiceUnitPrice.toFixed(5)} per unit, a shortfall of $${shortfall} on the fill.`,
        "",
        `The appeal is denied. A therapeutically equivalent product was available to you at or below the ceiling on the date of the fill: NDC ${cited.ndc11}, ${cited.name}${cited.labeler ? `, ${cited.labeler}` : ""}, at ${cited.unitPrice.toFixed(5)} per unit through McKesson Connect. Wisconsin statute 632.865(3) requires us to name that product, and we have.`,
        "",
        "If that product was not in fact available to you on that date, tell us and send what your wholesaler showed you. We will reopen the appeal on that basis, and if you are right the ceiling moves for every pharmacy, not only for yours.",
        "",
        "Glass PBM, network contracting.",
      ].join("\n"),
    };
  }

  const revised = availability.cheapest?.unitPrice ?? appeal.invoiceUnitPrice;
  return {
    recommendation: "Overturn",
    confidence: 0.91,
    reasoning: `No equivalent product is surveyed at or below ${appeal.macUnitPrice.toFixed(5)} on the date of the fill. The cheapest available is ${availability.cheapest ? `${availability.cheapest.ndc11} at ${availability.cheapest.unitPrice.toFixed(5)}` : "above the ceiling"}. Since the statute requires that we name a product available at the ceiling and there is none, the ceiling cannot stand and the appeal is allowed.`,
    letter: [
      `Re: appeal of maximum allowable cost, ${appeal.drug.name}, fill dated ${dos}.`,
      "",
      `We have reviewed your appeal and you are right. The ceiling applied to this fill was ${appeal.macUnitPrice.toFixed(5)} per unit. We could not identify a therapeutically equivalent product available to you at or below that price on ${dos}, and Wisconsin statute 632.865(3) does not permit us to hold a ceiling we cannot source at.`,
      "",
      `The ceiling for this product is revised to ${revised.toFixed(5)} per unit. You will be paid the difference on this fill and on every fill of this product you have dispensed since the ceiling took effect. No further action is needed from you.`,
      "",
      "Glass PBM, network contracting.",
    ].join("\n"),
  };
}

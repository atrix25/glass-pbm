import { prisma } from "@/lib/db";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import type {
  PickerDrug,
  PickerMember,
  PickerPharmacy,
  PickerPrescriber,
  PosScenario,
} from "@/components/pos-terminal";

/**
 * The pickers behind the point-of-sale terminal.
 *
 * The lists are deliberately curated rather than exhaustive. A drop-down of
 * 1,524 drugs and 2,488 members is a worse demonstration than a short list
 * chosen so that every interesting rejection is one selection away: a
 * specialty drug that needs an authorization, a brand with a generic
 * available, a drug carrying a quantity limit, and an ordinary generic that
 * simply pays.
 */
export async function getPosPickers(now: Date): Promise<{
  members: PickerMember[];
  drugs: PickerDrug[];
  pharmacies: PickerPharmacy[];
  prescribers: PickerPrescriber[];
  scenarios: PosScenario[];
  defaultDate: string;
}> {
  const scenarios = await buildScenarios(now);
  const memberIds = Array.from(
    new Set([
      ...DEMO_MEMBER_STORIES.map((m) => m.id),
      ...scenarios.map((s) => s.request.memberId),
    ]),
  );

  const [
    memberRows,
    planRows,
    entryRows,
    pharmacyRows,
    network,
    prescriberRows,
    scenarioPrescriberRows,
    scenarioDrugRows,
  ] = await Promise.all([
      prisma.member.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, firstName: true, lastName: true, cardholderId: true },
      }),
      prisma.eligibilitySpan.findMany({
        where: { memberId: { in: memberIds } },
        select: { memberId: true, benefitPlan: { select: { name: true } } },
      }),
      prisma.formularyEntry.findMany({
        where: {
          formularyId: "navitus-etf-2026",
          notCovered: false,
          planExclusion: false,
        },
        select: {
          drugId: true,
          level: true,
          requiresPA: true,
          hasQuantityLimit: true,
          qlQuantity: true,
          qlDays: true,
          drug: {
            select: {
              id: true,
              name: true,
              ndc11: true,
              isSpecialty: true,
              isBrandLabel: true,
              prices: {
                where: { priceType: "NADAC" },
                select: { unitPrice: true },
              },
            },
          },
        },
      }),
      prisma.pharmacy.findMany({
        select: { id: true, name: true, pharmacyType: true },
      }),
      prisma.networkPharmacy.findMany({
        where: { networkId: "navicare-limited" },
        select: { pharmacyId: true },
      }),
      /*
       * A short prescriber list, spread across specialties. The field only
       * changes the DUR segment — whether a conflict is one prescriber's own
       * therapy or two prescribers who cannot see each other's charts — so
       * the useful thing is to have more than one, not to have all 1,400.
       */
      prisma.prescriber.findMany({
        take: 12,
        orderBy: { lastName: "asc" },
        select: {
          npi: true,
          firstName: true,
          lastName: true,
          credential: true,
          specialty: true,
        },
      }),
      /*
       * The drugs a scenario transmits are chosen by the conflict, not by the
       * curation below, so they have to be added to the list explicitly or the
       * preset would select an option that is not there.
       */
      prisma.prescriber.findMany({
        where: {
          npi: {
            in: scenarios
              .map((s) => s.request.prescriberNpi)
              .filter((n): n is string => n !== null),
          },
        },
        select: {
          npi: true,
          firstName: true,
          lastName: true,
          credential: true,
          specialty: true,
        },
      }),
      prisma.formularyEntry.findMany({
        where: {
          formularyId: "navitus-etf-2026",
          drugId: { in: scenarios.map((s) => s.request.drugId) },
        },
        select: {
          drugId: true,
          level: true,
          requiresPA: true,
          qlQuantity: true,
          qlDays: true,
          drug: {
            select: { name: true, ndc11: true, isSpecialty: true },
          },
        },
      }),
    ]);

  const planByMember = new Map(
    planRows.map((p) => [p.memberId, p.benefitPlan.name]),
  );
  const order = new Map(DEMO_MEMBER_STORIES.map((m, i) => [m.id, i]));

  const members: PickerMember[] = memberRows
    .map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`,
      cardholderId: m.cardholderId,
      planName: planByMember.get(m.id) ?? "unknown plan",
    }))
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  // One representative drug per interesting shape, so every branch of the
  // engine is reachable from the drop-down.
  const priced = entryRows.filter((e) => e.drug.prices.length > 0);
  const wanted: PickerDrug[] = [];
  const pick = (
    predicate: (e: (typeof priced)[number]) => boolean,
    count: number,
  ) => {
    for (const e of priced) {
      if (wanted.length >= 40) return;
      if (count <= 0) return;
      if (wanted.some((w) => w.id === e.drugId)) continue;
      if (!predicate(e)) continue;
      wanted.push(toPickerDrug(e));
      count--;
    }
  };

  pick((e) => /SKYRIZI|DUPIXENT|ADALIMUMAB/i.test(e.drug.name), 4);
  pick((e) => e.requiresPA && e.drug.isSpecialty, 4);
  pick((e) => e.level === "4" && !e.requiresPA, 3);
  pick((e) => e.hasQuantityLimit && e.level === "2", 3);
  pick((e) => e.level === "3" && e.drug.isBrandLabel, 4);
  pick((e) => e.level === "2" && e.drug.isBrandLabel, 4);
  pick((e) => e.level === "1", 8);

  for (const e of scenarioDrugRows) {
    if (wanted.some((w) => w.id === e.drugId)) continue;
    wanted.push(
      toPickerDrug({
        drugId: e.drugId,
        level: e.level,
        requiresPA: e.requiresPA,
        qlQuantity: e.qlQuantity,
        qlDays: e.qlDays,
        drug: e.drug,
      }),
    );
  }

  const inNetwork = new Set(network.map((n) => n.pharmacyId));
  const pharmacies: PickerPharmacy[] = pharmacyRows
    .map((p) => ({
      id: p.id,
      name: p.name,
      pharmacyType: p.pharmacyType,
      inNetwork: inNetwork.has(p.id),
    }))
    .sort((a, b) => {
      if (a.inNetwork !== b.inNetwork) return a.inNetwork ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    members,
    drugs: wanted.sort((a, b) => (a.level ?? "9").localeCompare(b.level ?? "9")),
    pharmacies,
    prescribers: Array.from(
      new Map(
        [...scenarioPrescriberRows, ...prescriberRows].map((p) => [
          p.npi,
          {
            npi: p.npi,
            name: `${p.firstName} ${p.lastName}, ${p.credential}`,
            specialty: p.specialty,
          },
        ]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    scenarios,
    defaultDate: now.toISOString().slice(0, 10),
  };
}

/**
 * Presets that reproduce a conflict the book already contains.
 *
 * The retrospective pass found these after the fact, which is the normal way a
 * plan hears about them: a report, a month later, addressed to nobody in
 * particular. Re-transmitting the fill that triggered one shows the same
 * finding arriving in the second that it could still have changed something.
 *
 * Nothing here is invented for the demonstration. Each preset is a real
 * member, a real pair of fills, and the date the second one was dispensed.
 */
async function buildScenarios(now: Date): Promise<PosScenario[]> {
  const shapes: Array<{
    reasonCode: string;
    severity: string;
    label: string;
    blurb: string;
    /** The dose rule fires on a single claim, so it has no second claim to name. */
    needsRelated?: boolean;
  }> = [
    {
      reasonCode: "DD",
      severity: "Major",
      label: "Opioid and benzodiazepine together",
      blurb:
        "Two prescribers, neither able to see the other's chart. The processor can see both because it holds every claim.",
    },
    {
      reasonCode: "HD",
      severity: "Major",
      label: "Opioid dose past the CDC threshold",
      blurb:
        "No single fill is remarkable. The sum across concurrent fills is what crosses the line.",
      needsRelated: false,
    },
    {
      reasonCode: "TD",
      severity: "Moderate",
      label: "Two agents doing the same job",
      blurb:
        "Different molecules in one therapeutic class, overlapping. Usually a switch that was never stopped.",
    },
    {
      reasonCode: "DD",
      severity: "Moderate",
      label: "A moderate interaction worth a phone call",
      blurb:
        "Advisory rather than blocking: the pharmacist decides, and the claim pays either way.",
    },
  ];

  const scenarios: PosScenario[] = [];
  for (const shape of shapes) {
    const alert = await prisma.durAlert.findFirst({
      where: {
        reasonCode: shape.reasonCode,
        severity: shape.severity,
        dateOfService: { lte: now },
        ...(shape.needsRelated === false ? {} : { relatedClaimId: { not: null } }),
      },
      orderBy: { dateOfService: "desc" },
    });
    if (!alert) continue;

    const claim = await prisma.claim.findUnique({
      where: { id: alert.claimId },
      select: {
        drugId: true,
        pharmacyId: true,
        dateOfService: true,
        quantityDispensed: true,
        daysSupply: true,
        prescriberNpi: true,
        member: { select: { firstName: true, lastName: true } },
        drug: { select: { name: true } },
      },
    });
    if (!claim) continue;

    scenarios.push({
      id: alert.id,
      label: shape.label,
      blurb: shape.blurb,
      reasonCode: alert.reasonCode,
      severity: alert.severity,
      memberName: `${claim.member.firstName} ${claim.member.lastName}`,
      drugName: claim.drug.name,
      request: {
        memberId: alert.memberId,
        drugId: claim.drugId,
        pharmacyId: claim.pharmacyId,
        dateOfService: claim.dateOfService.toISOString().slice(0, 10),
        quantityDispensed: claim.quantityDispensed,
        daysSupply: claim.daysSupply,
        prescriberNpi: claim.prescriberNpi,
      },
    });
  }

  const emergency = await buildEmergencySupplyScenario(now);
  if (emergency) scenarios.push(emergency);

  return scenarios;
}

/**
 * The Saturday counter, which is the one preset that is not about a conflict.
 *
 * A drug that needs prior authorization, a member standing at a retail counter
 * on a day the prescriber's office is shut, and a pharmacist willing to dispense
 * five days. Submitted plainly this rejects for 75; submitted with the level of
 * service the pharmacy is supposed to send, the authorization is waived and the
 * member pays nothing. The preset carries the field, because the whole point of
 * the rule is that the pharmacy has to ask for it.
 */
async function buildEmergencySupplyScenario(
  now: Date,
): Promise<PosScenario | null> {
  const entry = await prisma.formularyEntry.findFirst({
    where: {
      requiresPA: true,
      // Levels 1 to 3 only: a Level 4 drug at a retail pharmacy is refused for
      // the channel before the authorization is ever considered, which would
      // demonstrate the wrong rule.
      level: { in: ["1", "2", "3"] },
      notCovered: false,
      planExclusion: false,
      mandatorySpecialty: false,
      drug: { prices: { some: { priceType: "NADAC" } } },
    },
    include: { drug: { select: { id: true, name: true } } },
    orderBy: { drug: { name: "asc" } },
  });
  if (!entry) return null;

  const member = await prisma.member.findFirst({
    where: {
      id: "mbr-DEMO-0004-01",
      // Nobody with a live authorization for it, or there is nothing to waive.
      // Step/quantity/tiering exceptions and grievances can also be Approved,
      // but they do not satisfy requiresPA at the counter.
      priorAuths: {
        none: {
          drugId: entry.drug.id,
          determination: "Approved",
          requestType: {
            in: ["PA", "Reauthorization", "Appeal", "FormularyException"],
          },
        },
      },
    },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) return null;

  const pharmacy = await prisma.pharmacy.findFirst({
    where: { id: "ph-walgreens-mad" },
    select: { id: true },
  });
  if (!pharmacy) return null;

  // The most recent Saturday that has already happened.
  const saturday = new Date(now);
  saturday.setUTCHours(0, 0, 0, 0);
  while (saturday.getUTCDay() !== 6) {
    saturday.setUTCDate(saturday.getUTCDate() - 1);
  }

  return {
    id: "emergency-supply",
    label: "A Saturday, and the prescriber's office is shut",
    blurb:
      "This drug needs an authorization nobody can obtain today. Transmitted with level of service 3, the plan waives the requirement for up to five days and charges the member nothing. Clear the field and send it again to see the same claim reject for 75.",
    reasonCode: "ES",
    severity: "Rule",
    memberName: `${member.firstName} ${member.lastName}`,
    drugName: entry.drug.name,
    request: {
      memberId: member.id,
      drugId: entry.drug.id,
      pharmacyId: pharmacy.id,
      dateOfService: saturday.toISOString().slice(0, 10),
      quantityDispensed: 5,
      daysSupply: 5,
      prescriberNpi: null,
      levelOfService: "3",
    },
  };
}

type EntryRow = {
  drugId: string;
  level: string | null;
  requiresPA: boolean;
  qlQuantity: number | null;
  qlDays: number | null;
  drug: { name: string; ndc11: string; isSpecialty: boolean };
};

function toPickerDrug(e: EntryRow): PickerDrug {
  /*
   * A sensible default fill matters more than it looks. Skyrizi is one
   * injection per 84 days; transmitting 30 units over 30 days rejects for
   * quantity before the claim reaches anything worth showing, and reads as an
   * engine fault rather than as the operator's typo. Where the formulary
   * publishes a limit, that limit is the default fill.
   */
  const hasQl = e.qlQuantity != null && e.qlDays != null;
  return {
    id: e.drugId,
    name: e.drug.name,
    ndc11: e.drug.ndc11,
    level: e.level,
    requiresPA: e.requiresPA,
    isSpecialty: e.drug.isSpecialty,
    typicalQuantity: hasQl ? e.qlQuantity! : e.drug.isSpecialty ? 1 : 30,
    typicalDaysSupply: hasQl ? Math.min(90, e.qlDays!) : 30,
  };
}

import { prisma } from "@/lib/db";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import type {
  PickerDrug,
  PickerMember,
  PickerPharmacy,
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
export async function getPosPickers(): Promise<{
  members: PickerMember[];
  drugs: PickerDrug[];
  pharmacies: PickerPharmacy[];
  defaultDate: string;
}> {
  const [memberRows, planRows, entryRows, pharmacyRows, network, latestClaim] =
    await Promise.all([
      prisma.member.findMany({
        where: { id: { in: DEMO_MEMBER_STORIES.map((m) => m.id) } },
        select: { id: true, firstName: true, lastName: true, cardholderId: true },
      }),
      prisma.eligibilitySpan.findMany({
        where: { memberId: { in: DEMO_MEMBER_STORIES.map((m) => m.id) } },
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
      prisma.claim.findFirst({
        orderBy: { dateOfService: "desc" },
        select: { dateOfService: true },
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

  // Default to a date late enough in the year that accumulators have moved,
  // which is when a quoted copay is least obvious.
  const latest = latestClaim?.dateOfService ?? new Date();

  return {
    members,
    drugs: wanted.sort((a, b) => (a.level ?? "9").localeCompare(b.level ?? "9")),
    pharmacies,
    defaultDate: latest.toISOString().slice(0, 10),
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

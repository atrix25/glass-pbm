/**
 * Rebuilding the daily rollup from the claim table.
 *
 * Since the landing page, the operations page and the sponsor dashboard all
 * read BookDay instead of counting Claim, `rollup_refresh` is the only thing
 * standing between a claim mutation and a dashboard that still shows the
 * numbers from before it. Two ways that job can be wrong are worth pinning.
 *
 * The first is that it cannot write at all. BookDay is keyed by `id` but its
 * `date` carries the unique index, so a refresh that invents a different `id`
 * for a day the book already holds inserts straight into a collision instead
 * of updating the row, and the job fails on its first day every time.
 *
 * The second is what it counts. A B2 reversal is stored against the original
 * date of service, so anything that counts rows per day without asking for B1
 * books the reversal as a second script on the day of the fill.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { refreshBookDayRollups } from "@/lib/rollups";

/*
 * Outside the plan year, so the fixture day can never be a day the seeded book
 * also holds, and every refresh below is windowed to it alone. A refresh with
 * no window rewrites every BookDay row in the book.
 */
const DAY = new Date("2019-03-04T00:00:00.000Z");
const FROM = new Date("2019-03-04T00:00:00.000Z");
const TO = new Date("2019-03-04T23:59:59.999Z");

/** The id convention the seed writes, which the fixture day is created under. */
const SEEDED_ID = "day-2019-03-04";

const CLAIM_IDS = ["rollup-fix-paid", "rollup-fix-reject", "rollup-fix-reversal"];

async function removeFixture() {
  await prisma.claim.deleteMany({ where: { id: { in: CLAIM_IDS } } });
  await prisma.bookDay.deleteMany({ where: { date: DAY } });
}

beforeAll(async () => {
  await removeFixture();

  /*
   * Borrow the foreign keys from a claim the book already has rather than
   * building a sponsor, member, plan, pharmacy, drug and contract to hang one
   * fixture off.
   */
  const sample = await prisma.claim.findFirst({
    where: { transactionCode: "B1", responseStatus: "P" },
    select: {
      sponsorId: true,
      memberId: true,
      benefitPlanId: true,
      pharmacyId: true,
      drugId: true,
      contractId: true,
    },
  });
  if (!sample) throw new Error("no paid claim to borrow keys from; seed the book first");

  await prisma.claim.createMany({
    data: [
      {
        ...sample,
        id: CLAIM_IDS[0],
        claimNumber: "ROLLUPFIX1",
        dateOfService: new Date("2019-03-04T10:00:00.000Z"),
        rxNumber: "rollup-fix-1",
        quantityDispensed: 30,
        daysSupply: 30,
        channel: "Retail",
        transactionCode: "B1",
        responseStatus: "P",
        brandGenericClass: "Generic",
        totalBilledCents: 2500,
        planPaidCents: 2000,
        patientPayCents: 500,
        pharmacyPaidCents: 2000,
        estimatedRebateCents: 100,
      },
      {
        ...sample,
        id: CLAIM_IDS[1],
        claimNumber: "ROLLUPFIX2",
        dateOfService: new Date("2019-03-04T11:00:00.000Z"),
        rxNumber: "rollup-fix-2",
        quantityDispensed: 30,
        daysSupply: 30,
        channel: "Retail",
        transactionCode: "B1",
        responseStatus: "R",
      },
      {
        // The reversal of the paid fill, dated to the day it reverses.
        ...sample,
        id: CLAIM_IDS[2],
        claimNumber: "ROLLUPFIX3",
        dateOfService: new Date("2019-03-04T10:00:00.000Z"),
        rxNumber: "rollup-fix-1",
        quantityDispensed: -30,
        daysSupply: 30,
        channel: "Retail",
        transactionCode: "B2",
        responseStatus: "A",
        brandGenericClass: "Generic",
        totalBilledCents: -2500,
        planPaidCents: -2000,
        patientPayCents: -500,
        pharmacyPaidCents: -2000,
        estimatedRebateCents: -100,
      },
    ],
  });
});

afterAll(async () => {
  await removeFixture();
});

describe("refreshing the daily rollup", () => {
  it("updates a day the book already holds instead of colliding with it", async () => {
    // The day as the seed left it, with totals the claims above disagree with.
    await prisma.bookDay.create({
      data: {
        id: SEEDED_ID,
        sponsorId: "steel-potatoes",
        date: DAY,
        claimsSubmitted: 999,
        claimsPaid: 999,
        totalBilledCents: 1,
      },
    });

    // This is the assertion the bug failed: the refresh threw P2002 on `date`.
    await expect(refreshBookDayRollups(FROM, TO)).resolves.toMatchObject({
      days: 1,
    });

    const rows = await prisma.bookDay.findMany({ where: { date: DAY } });
    expect(rows).toHaveLength(1);
    // Updated in place, so nothing downstream loses the row it was reading.
    expect(rows[0].id).toBe(SEEDED_ID);
    expect(rows[0].totalBilledCents).toBe(2500);
    expect(rows[0].claimsPaid).toBe(1);
  });

  it("does not count a reversal as another script on the day it reverses", async () => {
    await refreshBookDayRollups(FROM, TO);
    const day = await prisma.bookDay.findFirstOrThrow({ where: { date: DAY } });

    // Two B1 submissions — one paid, one rejected. The B2 is not a third.
    expect(day.claimsSubmitted).toBe(2);
    expect(day.claimsPaid).toBe(1);
    expect(day.claimsRejected).toBe(1);

    // The channel mix counts fills that were paid, so neither the rejected
    // claim nor the reversal may land in it.
    expect(day.retailClaims).toBe(1);
    expect(day.mailClaims).toBe(0);
    expect(day.retail90Claims).toBe(0);

    // And the reversal's negative money stays out of the day's paid totals.
    expect(day.totalBilledCents).toBe(2500);
    expect(day.planPaidCents).toBe(2000);
    expect(day.membersFilling).toBe(1);
  });

  it("creates a day the book does not have yet", async () => {
    await prisma.bookDay.deleteMany({ where: { date: DAY } });

    await refreshBookDayRollups(FROM, TO);

    const day = await prisma.bookDay.findFirstOrThrow({ where: { date: DAY } });
    // Written under the same convention as the seed, so a later refresh of the
    // same day still matches it.
    expect(day.id).toBe(SEEDED_ID);
    expect(day.claimsSubmitted).toBe(2);
  });
});

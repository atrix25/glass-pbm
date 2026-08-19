/**
 * The claim ledger is clock-cut. Claim detail and related-fill lookups must
 * use the same cut, or pinning early lets deep links and the data agent open
 * fills that have not been submitted yet — and related fills on a past claim
 * can list later months from the same Rx.
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";

describe("claim detail visibility as of the simulation clock", () => {
  const fills = [
    {
      id: "jan",
      claimNumber: "CLM-1",
      dateOfService: new Date("2026-01-15T00:00:00.000Z"),
    },
    {
      id: "mar",
      claimNumber: "CLM-2",
      dateOfService: new Date("2026-03-10T00:00:00.000Z"),
    },
    {
      id: "sep",
      claimNumber: "CLM-3",
      dateOfService: new Date("2026-09-01T00:00:00.000Z"),
    },
  ];

  it("hides future claim ids and numbers from detail lookup", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const visible = fills.filter(
      (c) => c.dateOfService.getTime() <= clock.today.getTime(),
    );
    expect(visible.map((c) => c.id)).toEqual(["jan", "mar"]);

    const byNumber = (idOrNumber: string) =>
      visible.find(
        (c) => c.id === idOrNumber || c.claimNumber === idOrNumber,
      ) ?? null;

    expect(byNumber("CLM-2")?.id).toBe("mar");
    expect(byNumber("sep")).toBeNull();
    expect(byNumber("CLM-3")).toBeNull();
  });

  it("keeps related fills on or before the pinned day", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const related = fills.filter(
      (c) => c.dateOfService.getTime() <= clock.today.getTime(),
    );
    expect(related).toHaveLength(2);
    expect(related[related.length - 1]?.dateOfService.toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
    expect(
      related.some((c) => c.dateOfService.getUTCMonth() >= 8),
    ).toBe(false);
  });
});

/**
 * Membership directory spend is clock-cut. The member detail page and the
 * member-service accumulator tools must use the same cut, or an early pin
 * shows a small YTD on /members and a full-year OOP on /members/[id].
 */

import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";
import { buildOopCurve } from "@/lib/queries/members";

describe("member out-of-pocket as of the simulation clock", () => {
  const claims = [
    {
      dateOfService: new Date("2026-01-15T00:00:00.000Z"),
      patientPayCents: 20_00,
      formularyLevel: "1",
      responseStatus: "P",
    },
    {
      dateOfService: new Date("2026-03-10T00:00:00.000Z"),
      patientPayCents: 40_00,
      formularyLevel: "2",
      responseStatus: "P",
    },
    {
      dateOfService: new Date("2026-09-01T00:00:00.000Z"),
      patientPayCents: 150_00,
      formularyLevel: "1",
      responseStatus: "P",
    },
    {
      dateOfService: new Date("2026-02-01T00:00:00.000Z"),
      patientPayCents: 0,
      formularyLevel: "1",
      responseStatus: "R",
    },
  ];

  it("excludes fills after the pinned day from the OOP curve", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const visible = claims.filter(
      (c) => c.dateOfService.getTime() <= clock.today.getTime(),
    );
    expect(visible).toHaveLength(3);

    const curve = buildOopCurve(visible);
    expect(curve).toHaveLength(2);
    expect(curve[curve.length - 1]).toEqual({
      date: "2026-03-10",
      rxOopCents: 60_00,
      federalOopCents: 60_00,
    });
  });

  it("matches listMembers YTD when the same cutoff is applied", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const visible = claims.filter(
      (c) =>
        c.responseStatus === "P" &&
        c.dateOfService.getTime() <= clock.today.getTime(),
    );
    const memberPaidCents = visible.reduce((s, c) => s + c.patientPayCents, 0);
    expect(memberPaidCents).toBe(60_00);

    const fullYear = claims
      .filter((c) => c.responseStatus === "P")
      .reduce((s, c) => s + c.patientPayCents, 0);
    expect(fullYear).toBe(210_00);
    expect(memberPaidCents).toBeLessThan(fullYear);
  });
});

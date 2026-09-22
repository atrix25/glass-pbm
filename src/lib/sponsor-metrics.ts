const DAY = 86_400_000;

/** Calendar-month exposure; termination dates are inclusive, as in adjudication. */
export function memberMonthsByMonth(
  spans: { memberId: string; effectiveDate: Date; terminationDate: Date | null }[],
  year: number,
  through: Date,
) {
  const end = Math.min(Date.UTC(year + 1, 0, 1), Date.UTC(through.getUTCFullYear(), through.getUTCMonth(), through.getUTCDate() + 1));
  const start = Date.UTC(year, 0, 1);
  const byMember = new Map<string, [number, number][]>();
  for (const span of spans) {
    const a = Math.max(start, span.effectiveDate.getTime());
    const b = Math.min(end, span.terminationDate ? span.terminationDate.getTime() + DAY : end);
    if (a >= b) continue;
    const intervals = byMember.get(span.memberId) ?? [];
    intervals.push([a, b]);
    byMember.set(span.memberId, intervals);
  }
  const months = Array<number>(12).fill(0);
  for (const intervals of byMember.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of intervals) {
      const last = merged.at(-1);
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    for (const [a, b] of merged) {
      for (let m = 0; m < 12; m++) {
        const lo = Date.UTC(year, m, 1), hi = Date.UTC(year, m + 1, 1);
        months[m] += Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / (hi - lo);
      }
    }
  }
  return months;
}

export function sponsorCosts(planCents: number, rebateCents: number, memberMonths: number, feePmpmCents: number) {
  const feesCents = Math.round(memberMonths * feePmpmCents);
  const netCents = planCents + feesCents - rebateCents;
  return { feesCents, netCents, pmpmCents: memberMonths > 0 ? Math.round(netCents / memberMonths) : null };
}

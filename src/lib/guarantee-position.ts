export interface GuaranteeBucket {
  channel: string; drugClass: string; count: number; awpCents: number;
  ingredientCents: number; feeCents: number; rebateCents: number;
  discountBps: number | null; feeTargetCents: number | null; rebateTargetCents: number | null;
  discountEligible: boolean; rebateEligible: boolean; missingAwp: number; simulatedAwp: number;
  citation: string | null;
}
export interface GuaranteeMeasure {
  id: string; name: string; unit: "percent" | "cents";
  target: number | null; actual: number | null; gap: number | null;
  shortfallCents: number | null; claims: number; missingClaims: number;
  status: "Above target" | "Below target" | "At target" | "Data needed" | "No volume";
}

/** Targets are weighted by their matching claim basis, never an average of rates. */
export function calculateGuaranteePosition(buckets: GuaranteeBucket[]): GuaranteeMeasure[] {
  return (["discount", "rebate", "fee"] as const).map(kind => {
    const eligible = buckets.filter(b => kind === "rebate" ? b.rebateEligible : b.discountEligible);
    let basis = 0, actual = 0, target = 0, missing = 0, claims = 0;
    for (const b of eligible) {
      claims += b.count;
      const rate = kind === "discount" ? b.discountBps : kind === "rebate" ? b.rebateTargetCents : b.feeTargetCents;
      if (rate === null || (kind === "discount" && (b.missingAwp > 0 || b.awpCents <= 0))) { missing += b.count; continue; }
      if (kind === "discount") { basis += b.awpCents; actual += b.awpCents - b.ingredientCents; target += b.awpCents * rate / 10000; }
      else { basis += b.count; actual += kind === "rebate" ? b.rebateCents : b.feeCents; target += b.count * rate; }
    }
    const valid = claims > 0 && missing === 0 && basis > 0;
    const scale = kind === "discount" ? 100 : 1;
    const a = valid ? actual / basis * scale : null;
    const t = valid ? target / basis * scale : null;
    // Positive means favorable; dispensing fees are a ceiling.
    const favorable = kind === "fee" ? target - actual : actual - target;
    return {
      id: kind, name: kind === "discount" ? "Overall effective discount" : kind === "rebate" ? "Rebate rate" : "Dispensing fee",
      unit: kind === "discount" ? "percent" : "cents", target: t, actual: a,
      gap: valid ? favorable / basis * scale : null,
      shortfallCents: valid ? Math.max(0, Math.round(-favorable)) : null,
      claims, missingClaims: missing,
      status: !claims ? "No volume" : !valid ? "Data needed" : Math.abs(favorable) < 0.5 ? "At target" : favorable > 0 ? "Above target" : "Below target",
    };
  });
}

/**
 * Exhibit C minimum rebate floor.
 *
 * The contract sets a per-brand-claim floor by channel (Commercial retail
 * $100, retail-90 $210, mail $260, specialty $750). Multiplying the whole
 * book's brand-claim count by the retail rate understates the floor whenever
 * non-retail brands are present — which can flip a short year into a false
 * "guarantee cleared."
 */

import { EXHIBIT_C_RATES } from "@/lib/contracts/wisconsin";

export interface ChannelBrandVolume {
  channel: string;
  claims: number;
}

export interface BrandRebateFloor {
  /** Sum of channel floors: claims × that channel's min rebate. */
  minGuaranteeCents: number;
  /** Brand claims that entered the floor (typically guarantee-dimension Brand). */
  brandClaims: number;
  /** Volume-weighted average floor per brand claim. */
  blendedFloorPerClaimCents: number;
}

/** Resolve the Commercial per-brand-claim floor for a channel. */
export function minRebateFloorForChannel(channel: string): number {
  const rate = EXHIBIT_C_RATES.find(
    (r) =>
      r.lineOfBusiness === "Commercial" &&
      r.channel === channel &&
      (r.drugClass === "Brand" || r.drugClass === "All") &&
      r.minRebatePerBrandClaimCents != null,
  );
  return rate?.minRebatePerBrandClaimCents ?? 0;
}

/**
 * Compute the contract rebate floor from per-channel brand claim volumes.
 *
 * Only brand rows belong here: generics do not earn the brand rebate floor,
 * and specialty's "All" rate still applies through the Specialty channel key
 * once specialty drugs have been classified into that channel.
 */
export function computeBrandRebateFloor(
  volumes: ChannelBrandVolume[],
): BrandRebateFloor {
  let minGuaranteeCents = 0;
  let brandClaims = 0;
  for (const { channel, claims } of volumes) {
    if (claims <= 0) continue;
    const floor = minRebateFloorForChannel(channel);
    minGuaranteeCents += claims * floor;
    brandClaims += claims;
  }
  return {
    minGuaranteeCents,
    brandClaims,
    blendedFloorPerClaimCents:
      brandClaims > 0 ? Math.round(minGuaranteeCents / brandClaims) : 0,
  };
}

import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import {
  BenefitSchema,
  patchEntry,
  type Benefit,
} from "@/lib/agents/account-management/model";
export const RELEASE_TAG = "account-management:release:v1";
export interface Release {
  id: string;
  benefit: Benefit;
  effectiveAt: string;
  proposalId: string;
  actor: string;
}
export async function latestRelease(at?: Date): Promise<Release | null> {
  const rows = await prisma.configVersion.findMany({
    where: { description: RELEASE_TAG },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  for (const row of rows) {
    const data = JSON.parse(row.payload);
    if (
      data.sponsorId !== tenantSponsorId() ||
      (at && new Date(data.effectiveAt) > at)
    )
      continue;
    return {
      id: row.id,
      benefit: BenefitSchema.parse(data.benefit),
      effectiveAt: data.effectiveAt,
      proposalId: data.proposalId,
      actor: row.createdBy,
    };
  }
  return null;
}
export async function activeEntries<
  T extends {
    drugId: string;
    level: string;
    requiresPA?: boolean;
    requiresStep?: boolean;
  },
>(entries: T[], at = new Date()): Promise<T[]> {
  const release = await latestRelease(at);
  return release
    ? entries.map((e) => patchEntry(e, e.drugId, release.benefit))
    : entries;
}

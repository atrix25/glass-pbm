import { prisma } from "@/lib/db";

/** Resolve drug ids to display metadata, keyed by id. */
export async function getDrugMetaById(ids: string[]) {
  const drugs = await prisma.drug.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, therapeuticClass: true, isSpecialty: true },
  });
  return new Map(drugs.map((d) => [d.id, d]));
}

import { prisma } from "@/lib/db";

export interface SourceUsage {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: string;
  publishedDate: string | null;
  retrievedAt: Date;
  contentHash: string | null;
  localPath: string | null;
  locator: string | null;
  notes: string | null;
  /** How many configured objects were read out of this document. */
  configuredRows: number;
  /** How many adjudicated claims or determinations cite it in their trace. */
  citations: number;
}

/**
 * Every document the system read, with the number of things that were taken
 * from it.
 *
 * The counts are the point. A bibliography proves nothing; a document that
 * nothing was loaded from is decoration, and this page should make that
 * visible rather than let a long list imply diligence.
 */
export async function listSources(): Promise<SourceUsage[]> {
  const [docs, traceCounts] = await Promise.all([
    prisma.sourceDocument.findMany({
      include: {
        _count: {
          select: {
            contractRates: true,
            formularyEntries: true,
            costShareRules: true,
            criteriaTrees: true,
            rebateTerms: true,
            auditFindings: true,
            drugPrices: true,
          },
        },
      },
      orderBy: [{ kind: "asc" }, { title: "asc" }],
    }),
    prisma.traceStep.groupBy({
      by: ["sourceDocumentId"],
      _count: { _all: true },
    }),
  ]);

  const cited = new Map(
    traceCounts
      .filter((t) => t.sourceDocumentId)
      .map((t) => [t.sourceDocumentId!, t._count._all]),
  );

  // A criteria form is cited once per step of every traversal it governed.
  const criteriaCounts = await prisma.$queryRaw<
    { sourceDocumentId: string; n: bigint }[]
  >`
    SELECT t.sourceDocumentId AS sourceDocumentId, COUNT(*) AS n
    FROM PADecisionStep d
    JOIN CriteriaStep cs ON cs.id = d.criteriaStepId
    JOIN PACriteriaTree t ON t.id = cs.treeId
    WHERE t.sourceDocumentId IS NOT NULL
    GROUP BY t.sourceDocumentId
  `;
  for (const row of criteriaCounts) {
    cited.set(
      row.sourceDocumentId,
      (cited.get(row.sourceDocumentId) ?? 0) + Number(row.n),
    );
  }

  /*
   * Claim traces are stored as a JSON blob rather than as rows, so a citation
   * has to be found by scanning the text. Scanning for all twenty-odd
   * documents costs a full pass per document, and most of them are contract
   * background that no adjudication step points at, so a sample first
   * establishes which ids are worth counting exactly.
   */
  const sample = await prisma.claim.findMany({
    where: { traceJson: { not: null } },
    select: { traceJson: true },
    take: 400,
  });
  const seen = new Set<string>();
  for (const { traceJson } of sample) {
    for (const m of traceJson!.matchAll(/"sourceDocumentId":"([^"]+)"/g)) {
      seen.add(m[1]);
    }
  }

  const scanned = docs.map((d) => d.id).filter((id) => seen.has(id));
  const claimCounts: Record<string, number> = {};
  if (scanned.length > 0) {
    const [row] = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
      `SELECT ${scanned
        .map(
          (_, i) =>
            `SUM(CASE WHEN instr(traceJson, ?) > 0 THEN 1 ELSE 0 END) AS c${i}`,
        )
        .join(", ")} FROM Claim WHERE traceJson IS NOT NULL`,
      ...scanned.map((id) => `"sourceDocumentId":"${id}"`),
    );
    scanned.forEach((id, i) => {
      claimCounts[id] = Number(row?.[`c${i}`] ?? 0);
    });
  }

  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    publisher: d.publisher,
    url: d.url,
    kind: d.kind,
    publishedDate: d.publishedDate,
    retrievedAt: d.retrievedAt,
    contentHash: d.contentHash,
    localPath: d.localPath,
    locator: d.locator,
    notes: d.notes,
    configuredRows:
      d._count.contractRates +
      d._count.formularyEntries +
      d._count.costShareRules +
      d._count.criteriaTrees +
      d._count.rebateTerms +
      d._count.auditFindings +
      d._count.drugPrices,
    citations: (claimCounts[d.id] ?? 0) + (cited.get(d.id) ?? 0),
  }));
}

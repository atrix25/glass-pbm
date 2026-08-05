/**
 * Attaches the prescriber roster to the book that already exists.
 *
 * Re-seeding 103,000 members to add one column is not a sensible trade, so
 * this walks the claim table as it stands and fills in the writing prescriber
 * after the fact. The assignment is deterministic, so running it twice is a
 * no-op and the book does not change shape between rehearsal and the meeting.
 *
 *   npx tsx scripts/attach-prescribers.ts
 */

import { prisma } from "../src/lib/db.js";
import { buildRoster, assignPrescriber, hashString } from "./seed/prescribers.js";

async function main() {
  const started = Date.now();

  console.log("Building prescriber roster...");
  const roster = buildRoster();
  console.log(
    `  ${roster.prescribers.length} prescribers across ${roster.bySpecialty.size} specialties ` +
      `(${roster.primaryCare.length} primary care)`,
  );

  await prisma.prescriber.deleteMany({});
  for (let i = 0; i < roster.prescribers.length; i += 500) {
    await prisma.prescriber.createMany({
      data: roster.prescribers.slice(i, i + 500),
    });
  }
  console.log("  roster written");

  console.log("Reading member and therapeutic class pairs...");
  const pairs = await prisma.$queryRaw<
    Array<{ memberId: string; cls: string | null }>
  >`
    SELECT DISTINCT c.memberId AS memberId, d.therapeuticClass AS cls
    FROM Claim c JOIN Drug d ON d.id = c.drugId
  `;
  console.log(`  ${pairs.length.toLocaleString()} pairs`);

  console.log("Assigning...");
  const rows = pairs.map((p) => {
    const cls = p.cls ?? "";
    return {
      memberId: p.memberId,
      cls,
      npi: assignPrescriber(roster, hashString(p.memberId), cls),
    };
  });

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _PxAssign`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE _PxAssign (memberId TEXT NOT NULL, cls TEXT NOT NULL, npi TEXT NOT NULL)`,
  );

  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const placeholders = slice.map(() => "(?,?,?)").join(",");
    const params: string[] = [];
    for (const r of slice) params.push(r.memberId, r.cls, r.npi);
    await prisma.$executeRawUnsafe(
      `INSERT INTO _PxAssign (memberId, cls, npi) VALUES ${placeholders}`,
      ...params,
    );
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX _PxAssign_idx ON _PxAssign (memberId, cls)`,
  );
  console.log(`  ${rows.length.toLocaleString()} assignments staged`);

  console.log("Updating claims...");
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE Claim
    SET prescriberNpi = (
      SELECT a.npi FROM _PxAssign a
      JOIN Drug d ON d.id = Claim.drugId
      WHERE a.memberId = Claim.memberId AND a.cls = COALESCE(d.therapeuticClass, '')
    )
  `);
  await prisma.$executeRawUnsafe(`DROP TABLE _PxAssign`);

  const [{ withPrescriber, total }] = await prisma.$queryRaw<
    Array<{ withPrescriber: number; total: number }>
  >`
    SELECT
      SUM(CASE WHEN prescriberNpi IS NOT NULL THEN 1 ELSE 0 END) AS withPrescriber,
      COUNT(*) AS total
    FROM Claim
  `;

  console.log(
    `  ${Number(updated).toLocaleString()} rows touched; ` +
      `${Number(withPrescriber).toLocaleString()} of ${Number(total).toLocaleString()} claims now carry a prescriber`,
  );

  await addNaturalVariation();

  const [{ avgPrescribers }] = await prisma.$queryRaw<
    Array<{ avgPrescribers: number }>
  >`
    SELECT AVG(n) AS avgPrescribers FROM (
      SELECT COUNT(DISTINCT prescriberNpi) AS n
      FROM Claim WHERE responseStatus = 'P' GROUP BY memberId
    )
  `;
  console.log(
    `  members average ${Number(avgPrescribers).toFixed(2)} distinct prescribers`,
  );
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Loosens the assignment so the book has a believable tail.
 *
 * Straight class-based assignment gives every member one or two prescribers
 * and one pharmacy, which would make a multi-prescriber detector a party
 * trick: anything above two would light up. Real books are messier. Members
 * see covering physicians when their own is unavailable, pick up a script at
 * whichever branch is on the way home, and get an urgent-care prescription
 * after hours. That noise is what a detector has to see through, so the book
 * needs it before any finding is worth showing.
 *
 * Only prescriber and pharmacy move, and pharmacies only ever swap for a
 * sibling of the same type inside the same network, so nothing that priced the
 * claim changes and every claim still reproduces to the cent.
 */
async function addNaturalVariation() {
  console.log("Adding natural variation...");

  // Coverage falls to primary care, which is who actually covers.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _Cover`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE _Cover (idx INTEGER PRIMARY KEY, npi TEXT NOT NULL)`,
  );
  await prisma.$executeRawUnsafe(`
    INSERT INTO _Cover (idx, npi)
    SELECT ROW_NUMBER() OVER (ORDER BY npi) - 1, npi
    FROM Prescriber WHERE specialty IN ('Family Medicine', 'Internal Medicine')
  `);

  // A deterministic scatter keyed off the claim sequence, so this is stable.
  const coveredClaims = await prisma.$executeRawUnsafe(`
    UPDATE Claim SET prescriberNpi = (
      SELECT npi FROM _Cover
      WHERE idx = (CAST(SUBSTR(Claim.claimNumber, 4) AS INTEGER) * 7919)
                  % (SELECT COUNT(*) FROM _Cover)
    )
    WHERE CAST(SUBSTR(claimNumber, 4) AS INTEGER) % 100 < 11
  `);
  await prisma.$executeRawUnsafe(`DROP TABLE _Cover`);
  console.log(
    `  ${Number(coveredClaims).toLocaleString()} claims moved to a covering prescriber`,
  );

  // Sibling pharmacies of the same type, in network, not 340B or specialty:
  // swapping inside this pool cannot change channel, contract rate, or any
  // exclusion, so pricing is untouched.
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _Sib`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE _Sib (pharmacyType TEXT, idx INTEGER, id TEXT, n INTEGER)`,
  );
  await prisma.$executeRawUnsafe(`
    INSERT INTO _Sib (pharmacyType, idx, id, n)
    SELECT p.pharmacyType,
           ROW_NUMBER() OVER (PARTITION BY p.pharmacyType ORDER BY p.id) - 1,
           p.id,
           COUNT(*) OVER (PARTITION BY p.pharmacyType)
    FROM Pharmacy p
    WHERE p.pharmacyType IN ('Chain', 'Independent')
      AND p.is340B = 0
      AND p.isDesignatedSpecialty = 0
      AND p.id <> 'ph-oon-illinois'
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX _Sib_idx ON _Sib (pharmacyType, idx)`,
  );

  const movedFills = await prisma.$executeRawUnsafe(`
    UPDATE Claim SET pharmacyId = (
      SELECT s.id FROM _Sib s
      WHERE s.pharmacyType = (SELECT pharmacyType FROM Pharmacy WHERE id = Claim.pharmacyId)
        AND s.idx = (CAST(SUBSTR(Claim.claimNumber, 4) AS INTEGER) * 104729) % s.n
    )
    WHERE CAST(SUBSTR(claimNumber, 4) AS INTEGER) % 100 >= 88
      AND pharmacyId IN (SELECT id FROM _Sib)
  `);
  await prisma.$executeRawUnsafe(`DROP TABLE _Sib`);
  console.log(
    `  ${Number(movedFills).toLocaleString()} fills moved to a sibling pharmacy`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

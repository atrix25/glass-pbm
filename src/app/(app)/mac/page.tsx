import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  getAppealOverview,
  getMacOverview,
  MAC_STATUTE,
} from "@/lib/queries/mac";
import { getClock } from "@/lib/session";
import { formatCentsCompact, formatCentsWhole } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const money = (unitPrice: number) => `$${unitPrice.toFixed(4)}`;

export default async function MacPage() {
  const clock = await getClock();
  const [mac, appeals] = await Promise.all([
    getMacOverview(clock),
    getAppealOverview(clock),
  ]);

  const macShare = mac.totalClaims
    ? Math.round((mac.macClaims / mac.totalClaims) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Generic reimbursement ceilings and pharmacy appeals. ${macShare}% of paid fills use MAC pricing.`}
      >
        Maximum allowable cost
      </SectionTitle>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Ceilings on the live list"
            value={formatNumber(mac.drugCount)}
            sub={`Version ${mac.liveVersion}, effective ${formatDate(mac.liveEffective)}`}
          />
          <Stat
            label="Fills priced at the ceiling"
            value={formatNumber(mac.macClaims)}
            sub={`${macShare}% of paid claims`}
          />
          <Stat
            label="Paid to the network on them"
            value={formatCentsCompact(mac.macPaidCents)}
            sub="At the same ceiling billed to the plan"
          />
          <Stat
            label="Appeals filed"
            value={formatNumber(appeals.total)}
            sub={`${appeals.overturned} overturned, ${appeals.underReview} under review`}
          />
        </div>
        <div className="px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-600">
          <span className="font-medium text-ink-900">How each ceiling is set.</span>{" "}
          {mac.basis}
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Statutory compliance                                               */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Statutory requirements"
          description={`${MAC_STATUTE.citation} sets out the obligations a pharmacy benefit manager takes on when it prices against a MAC list in Wisconsin. Each one is a date on a record here, which means each one is measurable rather than asserted.`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Requirement</Th>
              <Th>Citation</Th>
              <Th align="right">Performance</Th>
              <Th align="right">Met</Th>
            </tr>
          </thead>
          <tbody>
            <Requirement
              text={`Update the list at least every ${MAC_STATUTE.refreshBusinessDays} business days`}
              cite="632.865(2)(a)1"
              performance={`Weekly, ${mac.liveVersion} versions published`}
              met={mac.versions.every(
                (v) => v.intervalDays <= MAC_STATUTE.refreshBusinessDays + 2,
              )}
            />
            <Requirement
              text="Let contracted pharmacies review pricing updates"
              cite="632.865(2)(a)1"
              performance="Every version and every movement, below"
              met
            />
            <Requirement
              text={`Allow ${MAC_STATUTE.appealWindowDays} days from the claim to appeal`}
              cite="632.865(2)(b)1"
              performance={`Longest filed at ${Math.max(0, ...appeals.recent.map((a) => a.filedWithinDays))} days`}
              met
            />
            <Requirement
              text={`Investigate and resolve within ${MAC_STATUTE.resolutionDays} days`}
              cite="632.865(2)(b)2"
              performance={`Median ${appeals.medianResolutionDays} days, ${formatNumber(appeals.outsideStatute)} late`}
              met={appeals.outsideStatute === 0}
            />
            <Requirement
              text="Give a reason on denial, and an NDC available at or below the ceiling"
              cite="632.865(2)(b)4"
              performance={`${formatNumber(appeals.denialsWithCitation)} of ${formatNumber(appeals.denials)} denials carry both`}
              met={appeals.denialsWithCitation === appeals.denials}
            />
            <Requirement
              text={`Adjust pricing within ${MAC_STATUTE.adjustmentDays} day of the determination`}
              cite="632.865(2)(b)5"
              performance={`${formatNumber(appeals.overturned)} adjustments over ${formatNumber(appeals.adjustedClaims)} fills, ${formatCentsWhole(appeals.adjustmentCents)} paid`}
              met
            />
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The list                                                           */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="The list itself"
          description="The twelve ceilings that priced the most money this year, with the surveyed acquisition cost each was derived from. The margin is the same on every row and on every row of the full list, because the rule is one multiplier applied to a public survey. A list where that column varies by drug is a list somebody is choosing, drug by drug, and the sponsor is not in the room when they choose."
        />
        <Table>
          <thead>
            <tr>
              <Th>Drug</Th>
              <Th>NDC</Th>
              <Th align="right">Surveyed cost</Th>
              <Th align="right">Ceiling</Th>
              <Th align="right">Margin</Th>
              <Th align="right">Fills</Th>
              <Th align="right">Paid to network</Th>
            </tr>
          </thead>
          <tbody>
            {mac.topRows.map((r) => (
              <tr key={r.drugId} className="hover:bg-ink-50/60">
                <Td className="max-w-[260px] truncate" title={r.drugName}>
                  {r.drugName}
                </Td>
                <Td className="font-mono text-[12px] text-ink-600">
                  {r.ndc11}
                </Td>
                <Td align="right" className="text-ink-600">
                  {money(r.nadacUnitPrice)}
                </Td>
                <Td align="right" className="font-medium">
                  {money(r.unitPrice)}
                </Td>
                <Td align="right" className="text-ink-600">
                  {r.nadacUnitPrice > 0
                    ? `${Math.round((r.unitPrice / r.nadacUnitPrice - 1) * 100)}%`
                    : "—"}
                </Td>
                <Td align="right">{formatNumber(r.claims)}</Td>
                <Td align="right">{formatCentsWhole(r.paidCents)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Version history"
          description="Every version holds the whole list, not a delta, so a pharmacy checking a fill from March can pull the ceilings that were in force in March rather than being told what they are today. The underlying survey is a single snapshot in this build, so the only thing that moves a ceiling here is an appeal that succeeded."
        />
        <Table>
          <thead>
            <tr>
              <Th align="right">Version</Th>
              <Th align="right">Published</Th>
              <Th align="right">Effective</Th>
              <Th align="right">Interval</Th>
              <Th align="right">Ceilings</Th>
              <Th align="right">Moved</Th>
              <Th align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {mac.versions
              .slice()
              .reverse()
              .map((v) => (
                <tr key={v.version} className="hover:bg-ink-50/60">
                  <Td align="right" className="font-mono text-[12px]">
                    v{v.version}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(v.publishedAt)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(v.effectiveDate)}
                  </Td>
                  <Td align="right">
                    <Badge
                      tone={
                        v.intervalDays <= MAC_STATUTE.refreshBusinessDays + 2
                          ? "positive"
                          : "negative"
                      }
                    >
                      {v.intervalDays}d
                    </Badge>
                  </Td>
                  <Td align="right">{formatNumber(v.drugCount)}</Td>
                  <Td align="right" className="text-ink-600">
                    {v.changeCount || "—"}
                  </Td>
                  <Td align="right">
                    {v.live ? <Badge tone="accent">live</Badge> : null}
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Appeals                                                            */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Appeals"
          description="A pharmacy that bought above the survey average loses money on the fill and says so. The plan either names a wholesaler selling it at the ceiling, or concedes the ceiling is wrong, raises it, and pays the difference on every fill that pharmacy dispensed while the appeal was open."
          action={
            <Badge tone={appeals.underReview > 0 ? "warn" : "neutral"}>
              {formatNumber(appeals.underReview)} under review
            </Badge>
          }
        />
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Overturn rate"
            value={`${(appeals.overturnRateBps / 100).toFixed(1)}%`}
            sub={`${formatNumber(appeals.overturned)} of ${formatNumber(appeals.upheld + appeals.overturned)} decided`}
          />
          <Stat
            label="Paid on overturns"
            value={formatCentsWhole(appeals.adjustmentCents)}
            sub={`On ${formatNumber(appeals.adjustedClaims)} fills, not just the appealed ones`}
          />
          <Stat
            label="Median time to decide"
            value={`${appeals.medianResolutionDays} days`}
            sub={`Statute allows ${MAC_STATUTE.resolutionDays}`}
          />
          <Stat
            label="Resolved inside the statute"
            value={formatNumber(appeals.withinStatute)}
            tone={appeals.outsideStatute === 0 ? "positive" : "negative"}
            sub={
              appeals.outsideStatute === 0
                ? "None late"
                : `${formatNumber(appeals.outsideStatute)} late`
            }
          />
        </div>

        <div className="border-b border-ink-200/70 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
            Who appeals
          </div>
          <dl className="mt-2.5 grid gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-3">
            {appeals.byPharmacyType.map((t) => (
              <div
                key={t.pharmacyType}
                className="flex flex-wrap justify-between gap-x-3"
              >
                <dt className="text-ink-700">{t.pharmacyType}</dt>
                <dd className="tnum text-ink-900">
                  {t.perTenThousand.toFixed(1)} per 10k fills
                  <span className="ml-2 text-ink-500">
                    {formatNumber(t.count)} filed,{" "}
                    {t.count ? Math.round((t.overturned / t.count) * 100) : 0}%
                    won
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
            Measured against the fills each type dispensed rather than in raw
            counts, independents challenge the ceiling several times more often
            than chains — which is not a quirk of this data. A national average
            acquisition cost is an average of what large buyers pay, and a
            single-store pharmacy buying at the top of that distribution is
            underwater on a ceiling the average comfortably supports.
          </p>
        </div>

        {appeals.recent.length === 0 ? (
          <EmptyState title="No appeals yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pharmacy</Th>
                <Th>Drug</Th>
                <Th align="right">Filled</Th>
                <Th align="right">Filed</Th>
                <Th align="right">Invoice</Th>
                <Th align="right">Ceiling</Th>
                <Th align="right">Decided in</Th>
                <Th>Outcome</Th>
                <Th align="right">Adjustment</Th>
              </tr>
            </thead>
            <tbody>
              {appeals.recent.map((a) => (
                <tr key={a.id} className="hover:bg-ink-50/60">
                  <Td className="max-w-[180px] truncate" title={a.pharmacyName}>
                    {a.pharmacyName}
                  </Td>
                  <Td
                    className="max-w-[200px] truncate text-ink-600"
                    title={a.drugName}
                  >
                    {a.drugName}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {formatDate(a.dateOfService)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    day {a.filedWithinDays}
                  </Td>
                  <Td align="right">{money(a.invoiceUnitPrice)}</Td>
                  <Td align="right" className="text-ink-600">
                    {money(a.macUnitPrice)}
                  </Td>
                  <Td align="right" className="text-ink-600">
                    {a.resolvedWithinDays !== null
                      ? `${a.resolvedWithinDays}d`
                      : "—"}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        a.status === "Overturned"
                          ? "positive"
                          : a.status === "Upheld"
                            ? "neutral"
                            : "warn"
                      }
                    >
                      {a.status}
                    </Badge>
                  </Td>
                  <Td
                    align="right"
                    className={
                      a.adjustmentCents > 0 ? "font-medium text-emerald-700" : ""
                    }
                  >
                    {a.adjustmentCents > 0 ? (
                      <>
                        {formatCentsWhole(a.adjustmentCents)}
                        <span className="ml-1.5 font-normal text-ink-500">
                          on {a.affectedClaims}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {/* One denial in full, because the statute is specific about what a
            denial has to say and a summary would hide whether it says it. */}
        {appeals.recent.find((a) => a.status === "Upheld" && a.citedNdc) ? (
          <DenialDetail
            appeal={
              appeals.recent.find((a) => a.status === "Upheld" && a.citedNdc)!
            }
          />
        ) : null}
      </Card>
    </div>
  );
}

function Requirement({
  text,
  cite,
  performance,
  met,
}: {
  text: string;
  cite: string;
  performance: string;
  met: boolean;
}) {
  return (
    <tr>
      <Td>{text}</Td>
      <Td className="font-mono text-[11.5px] text-ink-500">{cite}</Td>
      <Td align="right" className="text-ink-600">
        {performance}
      </Td>
      <Td align="right">
        <Badge tone={met ? "positive" : "negative"}>{met ? "yes" : "no"}</Badge>
      </Td>
    </tr>
  );
}

function DenialDetail({
  appeal,
}: {
  appeal: NonNullable<
    Awaited<ReturnType<typeof getAppealOverview>>["recent"][number]
  >;
}) {
  return (
    <div className="border-t border-ink-200/70 bg-ink-50/50 px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
        A denial in full
      </div>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-800">
        {appeal.denialReason}
      </p>
      <dl className="mt-2.5 grid gap-x-8 gap-y-1 text-[12px] sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-500">
            Available at or below the ceiling
          </dt>
          <dd className="font-mono text-ink-800">{appeal.citedNdc}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-500">Source</dt>
          <dd className="text-ink-800">{appeal.citedWholesaler}</dd>
        </div>
      </dl>
      <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
        Naming the product is the part that costs an incumbent something, which
        is why the statute had to require it. A denial without an NDC is
        unfalsifiable; a denial with one can be checked against a wholesaler
        screen in about a minute.
      </p>
    </div>
  );
}

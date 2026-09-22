import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2 } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SimulatedBadge,
  Table,
  Td,
  Th,
  VerifiedBadge,
} from "@/components/ui";
import { TraceViewer, type TraceSource } from "@/components/trace-viewer";
import { NcpdpPanel } from "@/components/ncpdp-panel";
import { getClaimDetail, getRelatedFills } from "@/lib/queries/claims";
import { reproduceClaim } from "@/lib/engine/reproduce";
import { SOURCES } from "@/lib/sources";
import { formatCents, formatUnitPrice } from "@/lib/money";
import { formatDate, formatPercent, levelMeta } from "@/lib/utils";
import { REJECT_MEMBER_EXPLANATION, type TraceStepInput } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

const SOURCE_MAP: Record<string, TraceSource> = Object.fromEntries(
  SOURCES.map((s) => [
    s.id,
    { id: s.id, title: s.title, publisher: s.publisher, url: s.url },
  ]),
);

export default async function ClaimProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const claim = await getClaimDetail(id);
  if (!claim) notFound();

  /*
   * Traces are not stored, they are re-derived. A claim seeded before that
   * change still carries one, so it is used when present; everything else runs
   * back through the engine here. The reproduction reports whether it landed
   * on the same money the book recorded, and that answer is shown on the page.
   */
  const reproduced = claim.traceJson ? null : await reproduceClaim(claim.id);
  const trace: TraceStepInput[] = claim.traceJson
    ? (JSON.parse(claim.traceJson) as TraceStepInput[])
    : (reproduced?.outcome.trace ?? []);
  const related = await getRelatedFills(claim.memberId, claim.drugId);
  const rejected = claim.responseStatus === "R";
  const rejectCodes: string[] = JSON.parse(claim.rejectCodes);
  const meta = levelMeta(claim.formularyLevel);

  const nadac = claim.nadacTotalCents ?? 0;
  const markup = nadac > 0 ? claim.totalBilledCents / nadac : 0;

  // The competing arms, reconstructed from the pricing trace step so the page
  // shows what each benchmark WOULD have paid, not only the one that won.
  const pricingStep = trace.find((s) => s.ruleId === "pricing.lesser-of");
  const armInputs =
    (pricingStep?.inputs as { arms?: { arm: string; amount: string }[] } | undefined)
      ?.arms ?? [];
  const winner =
    (pricingStep?.output as { winningArm?: string } | undefined)?.winningArm ?? "";

  return (
    <div className="space-y-5">
      <Link
        href="/claims"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 transition hover:text-ink-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Claim ledger
      </Link>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-lg font-semibold tracking-tight text-ink-900">
                {claim.claimNumber}
              </h1>
              {rejected ? (
                <Badge tone="negative">
                  <Ban className="h-3 w-3" />
                  Rejected {rejectCodes.join(", ")}
                </Badge>
              ) : (
                <Badge tone="positive">
                  <CheckCircle2 className="h-3 w-3" />
                  Paid
                </Badge>
              )}
              <Badge className={meta.className}>{meta.label}</Badge>
              <Badge tone="neutral">{claim.channel}</Badge>
              {claim.brandGenericClass ? (
                <Badge tone="neutral">{claim.brandGenericClass}</Badge>
              ) : null}
              {claim.scenarioTag ? (
                <Badge tone="warn">scenario: {claim.scenarioTag}</Badge>
              ) : null}
            </div>
            <p className="mt-2 text-[14px] font-medium text-ink-900">
              {claim.drug.name}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-600">
              {claim.quantityDispensed} units, {claim.daysSupply} days supply,
              fill {claim.fillNumber} · Rx {claim.rxNumber} · NDC{" "}
              {claim.drug.ndc11}
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-1.5 text-[13px]">
            <Meta label="Member">
              <Link
                href={`/members/${claim.member.id}`}
                className="text-glass-700 hover:text-glass-900"
              >
                {claim.member.firstName} {claim.member.lastName}
              </Link>
            </Meta>
            <Meta label="Date of service">{formatDate(claim.dateOfService)}</Meta>
            <Meta label="Pharmacy">{claim.pharmacy.name}</Meta>
            <Meta label="Plan">{claim.benefitPlan.name}</Meta>
          </dl>
        </div>
      </Card>

      {rejected ? (
        <Card className="border-rose-600/25 bg-rose-50/40">
          <div className="px-5 py-4">
            <h2 className="text-[13.5px] font-semibold text-rose-900">
              {claim.rejectMessage}
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-rose-900/80">
              {REJECT_MEMBER_EXPLANATION[rejectCodes[0]] ??
                "The claim did not pass an adjudication rule."}
            </p>
            <p className="mt-2 text-[12.5px] text-rose-900/60">
              The rule that produced this reject is marked below. Nothing after
              it ran, which is why the derivation stops where it does.
            </p>
          </div>
        </Card>
      ) : (
        <MoneyPanel claim={claim} markup={markup} nadac={nadac} />
      )}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="The derivation"
            description="Every rule the engine evaluated, in the order it ran. Rules that changed the outcome are marked. Open any rule to see the values it read and the document it came from."
          />
          {reproduced ? <ReproductionNotice reproduced={reproduced} /> : null}
          <TraceViewer steps={trace} sources={SOURCE_MAP} />
        </Card>

        <div className="space-y-5">
          {!rejected && armInputs.length > 0 ? (
            <Card>
              <CardHeader
                title="Pricing comparisons"
                description="Each arm priced the same fill. The contract pays the lowest."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Pricing arm</Th>
                    <Th align="right">Would have paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {armInputs.map((a) => {
                    const won = a.arm === winner;
                    return (
                      <tr key={a.arm} className={won ? "bg-glass-50/70" : ""}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                won ? "font-semibold text-glass-900" : "text-ink-700"
                              }
                            >
                              {a.arm}
                            </span>
                            {won ? <Badge tone="accent">won</Badge> : null}
                            {a.arm.includes("AWP") ? <SimulatedBadge /> : null}
                          </div>
                        </Td>
                        <Td align="right" className={won ? "font-semibold" : ""}>
                          {a.amount}
                        </Td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-ink-200">
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="text-ink-700">
                          Pharmacy acquisition cost (NADAC)
                        </span>
                        <VerifiedBadge
                          href="https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704"
                          label="CMS file"
                        />
                      </div>
                      <span className="block text-[11.5px] text-ink-500">
                        {claim.nadacUnitAtDos
                          ? `${formatUnitPrice(claim.nadacUnitAtDos)} per unit`
                          : "not on file"}
                      </span>
                    </Td>
                    <Td align="right" className="text-ink-600">
                      {formatCents(nadac)}
                    </Td>
                  </tr>
                </tbody>
              </Table>
              <div className="border-t border-ink-100 px-5 py-3 text-[12.5px] leading-relaxed text-ink-500">
                NADAC is not a term of this contract. It is shown on every claim
                so the gap between what the pharmacy paid for the drug and what
                the plan paid for it is visible without an audit.
              </div>
            </Card>
          ) : null}

          {!rejected ? <CostSharePanel claim={claim} /> : null}

          <NcpdpPanel claim={serializeForNcpdp(claim, rejectCodes)} />

          {related.length > 1 ? (
            <Card>
              <CardHeader
                title="Fill history"
                description="Every fill of this drug for this member."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th align="center">Fill</Th>
                    <Th align="right">Plan cost</Th>
                    <Th align="right">Member</Th>
                  </tr>
                </thead>
                <tbody>
                  {related.map((r) => (
                    <tr
                      key={r.id}
                      className={r.id === claim.id ? "bg-glass-50/70" : ""}
                    >
                      <Td>
                        <Link
                          href={`/claims/${r.id}`}
                          className="hover:text-glass-700"
                        >
                          {formatDate(r.dateOfService)}
                        </Link>
                      </Td>
                      <Td align="center">
                        {r.responseStatus === "R" ? (
                          <Badge tone="negative">rejected</Badge>
                        ) : (
                          r.fillNumber
                        )}
                      </Td>
                      <Td align="right">
                        {r.responseStatus === "R"
                          ? "—"
                          : formatCents(r.totalBilledCents)}
                      </Td>
                      <Td align="right">
                        {r.responseStatus === "R"
                          ? "—"
                          : formatCents(r.patientPayCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ClaimDetail = NonNullable<Awaited<ReturnType<typeof getClaimDetail>>>;

/**
 * Say plainly that the derivation below was recomputed, and whether it agreed.
 *
 * A reproduction that silently disagreed with the book would be worse than no
 * reproduction at all, so the comparison is stated rather than assumed.
 */
function ReproductionNotice({
  reproduced,
}: {
  reproduced: NonNullable<Awaited<ReturnType<typeof reproduceClaim>>>;
}) {
  const { matches, fields } = reproduced.agreement;
  const disagreements = fields.filter((f) => f.stored !== f.reproduced);
  const { reversalOf } = reproduced;

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 ${
        matches
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-rose-300 bg-rose-50"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {matches ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        ) : (
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        )}
        <div className="min-w-0">
          <p
            className={`text-[13px] font-medium ${
              matches ? "text-emerald-900" : "text-rose-900"
            }`}
          >
            {matches
              ? `Recomputed just now, in ${reproduced.elapsedMs} ms, and it agrees with the book.`
              : "Recomputed just now, and it does not agree with the book."}
          </p>
          <p
            className={`mt-1 text-[12.5px] leading-relaxed ${
              matches ? "text-emerald-900/70" : "text-rose-900/75"
            }`}
          >
            {matches ? (
              reversalOf ? (
                <>
                  A reversal has no pricing of its own, so the rules below are
                  the ones that priced{" "}
                  <Link
                    href={`/claims/${reversalOf.id}`}
                    className="font-medium underline decoration-emerald-700/30 hover:decoration-emerald-700"
                  >
                    {reversalOf.claimNumber}
                  </Link>
                  , the fill this backs out. That fill was re-adjudicated just
                  now and every figure on it was negated, which is how the book
                  recorded this reversal and why the money above is negative.
                </>
              ) : (
                <>
                  This derivation was not read from a log. The engine was run
                  again against the inputs stored on the claim, and it landed on
                  the same {fields.length} figures the plan actually paid.
                </>
              )
            ) : (
              <>
                {disagreements
                  .map(
                    (f) =>
                      `${f.field}: book ${f.stored}, recomputed ${f.reproduced}`,
                  )
                  .join("; ")}
                . That is a defect, not a rounding artifact, and it should be
                treated as one.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function MoneyPanel({
  claim,
  markup,
  nadac,
}: {
  claim: ClaimDetail;
  markup: number;
  nadac: number;
}) {
  const spread = claim.totalBilledCents - claim.totalAllowedCents;

  return (
    <Card>
      <CardHeader
        title="Payment breakdown"
        description="Both sides of the same claim. Under a pass-through contract these two columns are the same number by construction."
      />
      <div className="grid gap-px bg-ink-200/60 lg:grid-cols-3">
        <Column
          title="Billed to the plan"
          rows={[
            ["Ingredient cost", claim.billedIngredientCostCents],
            ["Dispensing fee", claim.billedDispensingFeeCents],
          ]}
          total={["Total billed", claim.totalBilledCents]}
        />
        <Column
          title="Paid to the pharmacy"
          rows={[
            ["Allowed ingredient cost", claim.allowedIngredientCostCents],
            ["Dispensing fee", claim.allowedDispensingFeeCents],
            ["Less member payment", -claim.patientPayCents],
          ]}
          total={["Remitted to pharmacy", claim.pharmacyPaidCents]}
        />
        <Column
          title="Cost sharing"
          rows={[
            ["Plan pays", claim.planPaidCents],
            ["Member pays", claim.patientPayCents],
            ...(claim.brandSelectionPenaltyCents
              ? ([
                  ["  of which brand penalty", claim.brandSelectionPenaltyCents],
                ] as [string, number][])
              : []),
            ["Manufacturer rebate to plan", -claim.estimatedRebateCents],
          ]}
          total={[
            "Net plan cost",
            claim.planPaidCents - claim.estimatedRebateCents,
          ]}
        />
      </div>

      <div className="grid gap-px border-t border-ink-200/60 bg-ink-200/60 sm:grid-cols-3">
        <Footnote
          label="PBM spread on this claim"
          value={formatCents(spread)}
          tone={spread === 0 ? "positive" : "negative"}
          note="Billed to the plan minus remitted to the pharmacy"
        />
        <Footnote
          label="Paid versus acquisition cost"
          value={markup ? `${markup.toFixed(3)}×` : "—"}
          note={`Plan paid ${formatCents(claim.totalBilledCents)} for a drug the pharmacy acquired for ${formatCents(nadac)}`}
        />
        <Footnote
          label="Member share of the fill"
          value={
            claim.totalBilledCents !== 0
              ? formatPercent(
                  claim.patientPayCents / claim.totalBilledCents,
                )
              : "—"
          }
          note={
            claim.rebateEligible
              ? "Below the 50% threshold, so the claim keeps its rebate"
              : (claim.rebateExclusionReason ?? "No rebate on this claim")
          }
        />
      </div>
    </Card>
  );
}

function CostSharePanel({ claim }: { claim: ClaimDetail }) {
  const plan = claim.benefitPlan;
  return (
    <Card>
      <CardHeader
        title="Member cost share"
        description="What the member owes and which of the plan's two out-of-pocket limits it counts toward."
      />
      <dl className="divide-y divide-ink-100">
        <Line label="Copay or coinsurance" value={formatCents(claim.copayCoinsuranceCents)} />
        {claim.appliedToDeductibleCents ? (
          <Line
            label="Applied to deductible"
            value={formatCents(claim.appliedToDeductibleCents)}
          />
        ) : null}
        {claim.brandSelectionPenaltyCents ? (
          <Line
            label="Brand selection penalty (DAW 1)"
            value={formatCents(claim.brandSelectionPenaltyCents)}
          />
        ) : null}
        <Line
          label="Member pays"
          value={formatCents(claim.patientPayCents)}
          strong
        />
      </dl>
      <div className="border-t border-ink-100 px-5 py-3 text-[12.5px] leading-relaxed text-ink-600">
        {["1", "2"].includes(claim.formularyLevel ?? "") ? (
          <>
            Level {claim.formularyLevel} cost share counts toward the{" "}
            {formatCents(plan.rxOopLimitIndividual)} prescription out-of-pocket
            limit and the {formatCents(plan.federalOopLimitIndividual)} federal
            maximum.
          </>
        ) : (
          <>
            Level {claim.formularyLevel} cost share does{" "}
            <strong className="font-semibold text-ink-900">not</strong> count
            toward the {formatCents(plan.rxOopLimitIndividual)} prescription
            out-of-pocket limit. It reaches only the{" "}
            {formatCents(plan.federalOopLimitIndividual)} federal maximum. This
            asymmetry is in the Certificate of Coverage and is the single most
            common source of member confusion on this plan.
          </>
        )}
      </div>
    </Card>
  );
}

function Column({
  title,
  rows,
  total,
}: {
  title: string;
  rows: [string, number][];
  total: [string, number];
}) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
        {title}
      </div>
      <dl className="mt-2.5 space-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="whitespace-pre text-ink-600">{label}</dt>
            <dd className="tnum text-ink-800">{formatCents(value)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-ink-200 pt-1.5">
          <dt className="font-medium text-ink-900">{total[0]}</dt>
          <dd className="tnum font-semibold text-ink-900">
            {formatCents(total[1])}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Footnote({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="bg-white px-5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
        {label}
      </div>
      <div
        className={`tnum mt-0.5 text-[16px] font-semibold ${
          tone === "positive"
            ? "text-emerald-700"
            : tone === "negative"
              ? "text-rose-700"
              : "text-ink-900"
        }`}
      >
        {value}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{note}</p>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 py-2 text-[13px]">
      <dt className={strong ? "font-medium text-ink-900" : "text-ink-600"}>
        {label}
      </dt>
      <dd className={`tnum ${strong ? "font-semibold text-ink-900" : "text-ink-800"}`}>
        {value}
      </dd>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{children}</dd>
    </div>
  );
}

function serializeForNcpdp(claim: ClaimDetail, rejectCodes: string[]) {
  return {
    request: {
      "101-A1 BIN Number": "610602",
      "104-A4 Processor Control Number": "NVT",
      "103-A3 Transaction Code": claim.transactionCode,
      "109-A9 Transaction Count": "1",
      "202-B2 Service Provider ID Qualifier": "01 (NPI)",
      "201-B1 Service Provider ID": claim.pharmacy.npi,
      "401-D1 Date of Service": claim.dateOfService.toISOString().slice(0, 10),
      "302-C2 Cardholder ID": claim.member.cardholderId,
      "303-C3 Person Code": claim.member.personCode,
      "306-C6 Patient Relationship Code": claim.member.relationshipCode,
      "402-D2 Prescription Service Reference Number": claim.rxNumber,
      "403-D3 Fill Number": String(claim.fillNumber),
      "407-D7 Product/Service ID": claim.drug.ndc11,
      "436-E1 Product/Service ID Qualifier": "03 (NDC)",
      "442-E7 Quantity Dispensed": String(claim.quantityDispensed),
      "405-D5 Days Supply": String(claim.daysSupply),
      "408-D8 DAW/Product Selection Code": claim.dawCode,
      "406-D6 Compound Code": claim.compoundCode,
      "409-D9 Ingredient Cost Submitted": fmt(claim.ingredientCostSubmittedCents),
      "412-DC Dispensing Fee Submitted": fmt(claim.dispensingFeeSubmittedCents),
      "426-DQ Usual and Customary Charge": fmt(claim.usualAndCustomaryCents),
      "430-DU Gross Amount Due": fmt(claim.grossAmountDueCents),
      "411-DB Prescriber ID": claim.prescriberNpi ?? "",
    },
    response: {
      "112-AN Transaction Response Status":
        claim.responseStatus === "P" ? "P (Paid)" : "R (Rejected)",
      ...(claim.responseStatus === "R"
        ? {
            "511-FB Reject Code": rejectCodes.join(", "),
            "526-FQ Additional Message": claim.rejectMessage ?? "",
          }
        : {
            "506-F6 Ingredient Cost Paid": fmt(claim.allowedIngredientCostCents),
            "507-F7 Dispensing Fee Paid": fmt(claim.allowedDispensingFeeCents),
            "509-F9 Total Amount Paid": fmt(claim.pharmacyPaidCents),
            "505-F5 Patient Pay Amount": fmt(claim.patientPayCents),
            "518-FI Amount of Copay": fmt(claim.copayCoinsuranceCents),
            "517-FH Amount Applied to Periodic Deductible": fmt(
              claim.appliedToDeductibleCents,
            ),
            "522-FM Basis of Reimbursement Determination":
              claim.basisOfReimbursement ?? "",
            "523-FN Amount Attributed to Sales Tax": "0.00",
            "577-G3 Estimated Generic Savings": fmt(
              claim.brandSelectionPenaltyCents,
            ),
          }),
    },
  };
}

function fmt(cents: number) {
  return (cents / 100).toFixed(2);
}

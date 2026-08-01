"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Loader2, Send } from "lucide-react";
import { Badge, Card, CardHeader, SimulatedBadge, Table, Td, Th } from "@/components/ui";
import { TraceViewer, type TraceSource } from "@/components/trace-viewer";
import { NcpdpPanel } from "@/components/ncpdp-panel";
import { formatCents } from "@/lib/money";
import { cn, formatDate } from "@/lib/utils";
import {
  PRICING_ARM_LABEL,
  REJECT_MEMBER_EXPLANATION,
  type PricingArm,
  type TraceStepInput,
} from "@/lib/engine/types";

export interface PickerMember {
  id: string;
  name: string;
  cardholderId: string;
  planName: string;
}

export interface PickerDrug {
  id: string;
  name: string;
  ndc11: string;
  level: string | null;
  requiresPA: boolean;
  isSpecialty: boolean;
  typicalQuantity: number;
  typicalDaysSupply: number;
}

export interface PickerPharmacy {
  id: string;
  name: string;
  pharmacyType: string;
  inNetwork: boolean;
}

interface PosResult {
  outcome: {
    responseStatus: string;
    rejectCodes: string[];
    rejectMessage?: string;
    channel: string;
    brandGeneric: string;
    formularyLevel?: string;
    allowedIngredientCostCents: number;
    allowedDispensingFeeCents: number;
    totalAllowedCents: number;
    pharmacyPaidCents: number;
    totalBilledCents: number;
    planPaidCents: number;
    patientPayCents: number;
    appliedToDeductibleCents: number;
    copayCoinsuranceCents: number;
    brandSelectionPenaltyCents: number;
    estimatedRebateCents: number;
    pricing?: {
      winningArm: string;
      basisOfReimbursement: string;
      arms: { arm: string; applicable: boolean; ingredientCostMicros: number }[];
    };
    trace: TraceStepInput[];
  };
  context: {
    memberName: string;
    cardholderId: string;
    planName: string;
    drugName: string;
    ndc11: string;
    pharmacyName: string;
    priorFills: number;
    lastFillDate: string | null;
    rxOopAccumulatedCents: number;
    rxOopLimitCents: number;
    deductibleAccumulatedCents: number;
    deductibleCents: number;
    approvedPAs: { drugName: string; through: string | null }[];
  };
}

export function PosTerminal({
  members,
  drugs,
  pharmacies,
  sources,
  defaultDate,
}: {
  members: PickerMember[];
  drugs: PickerDrug[];
  pharmacies: PickerPharmacy[];
  sources: Record<string, TraceSource>;
  defaultDate: string;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [drugId, setDrugId] = useState(drugs[0]?.id ?? "");
  const [pharmacyId, setPharmacyId] = useState(pharmacies[0]?.id ?? "");
  const [dateOfService, setDate] = useState(defaultDate);
  const [quantity, setQuantity] = useState(drugs[0]?.typicalQuantity ?? 30);
  const [daysSupply, setDays] = useState(drugs[0]?.typicalDaysSupply ?? 30);
  const [dawCode, setDaw] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PosResult | null>(null);

  const drug = drugs.find((d) => d.id === drugId);

  function chooseDrug(id: string) {
    setDrugId(id);
    const next = drugs.find((d) => d.id === id);
    if (next) {
      setQuantity(next.typicalQuantity);
      setDays(next.typicalDaysSupply);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          drugId,
          pharmacyId,
          dateOfService,
          quantityDispensed: Number(quantity),
          daysSupply: Number(daysSupply),
          dawCode,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Adjudication failed");
      setResult(body as PosResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjudication failed");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      {/* Terminal */}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="B1 billing request"
            description="The fields a pharmacy transmits. Nothing is saved: this is a test claim, evaluated and discarded."
          />
          <div className="space-y-3.5 px-5 py-4">
            <Field label="302-C2 Cardholder">
              <Select value={memberId} onChange={setMemberId}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.cardholderId} ({m.planName})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="407-D7 Product / Service ID">
              <Select value={drugId} onChange={chooseDrug}>
                {drugs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.level ? ` — Level ${d.level}` : ""}
                    {d.requiresPA ? " (PA)" : ""}
                  </option>
                ))}
              </Select>
              {drug ? (
                <p className="mt-1 font-mono text-[11px] text-ink-500">
                  NDC {drug.ndc11}
                </p>
              ) : null}
            </Field>

            <Field label="201-B1 Service Provider">
              <Select value={pharmacyId} onChange={setPharmacyId}>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.pharmacyType}
                    {p.inNetwork ? "" : " (out of network)"}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="401-D1 Date of service">
                <Input type="date" value={dateOfService} onChange={setDate} />
              </Field>
              <Field label="408-D8 DAW code">
                <Select value={dawCode} onChange={setDaw}>
                  <option value="0">0 — No product selection</option>
                  <option value="1">1 — Prescriber requested brand</option>
                  <option value="2">2 — Member requested brand</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="442-E7 Quantity">
                <Input
                  type="number"
                  value={String(quantity)}
                  onChange={(v) => setQuantity(Number(v))}
                />
              </Field>
              <Field label="405-D5 Days supply">
                <Input
                  type="number"
                  value={String(daysSupply)}
                  onChange={(v) => setDays(Number(v))}
                />
              </Field>
            </div>

            <button
              onClick={submit}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-glass-700 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-glass-800 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Transmit claim
            </button>

            {error ? (
              <p className="text-[12.5px] text-rose-700">{error}</p>
            ) : null}
          </div>
        </Card>

        {result ? <MemberPosition ctx={result.context} /> : null}
      </div>

      {/* Response */}
      <div className="space-y-5">
        {!result ? (
          <Card>
            <div className="px-5 py-16 text-center">
              <p className="text-sm font-medium text-ink-700">
                No response yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-500">
                Fill in the request and transmit it. The claim goes through the
                same engine as the 36,000 claims in the ledger, against this
                member&apos;s real accumulator position and fill history on the
                date you choose.
              </p>
            </div>
          </Card>
        ) : (
          <Response result={result} sources={sources} />
        )}
      </div>
    </div>
  );
}

function Response({
  result,
  sources,
}: {
  result: PosResult;
  sources: Record<string, TraceSource>;
}) {
  const { outcome } = result;
  const rejected = outcome.responseStatus === "R";

  return (
    <>
      <Card
        className={cn(
          rejected
            ? "border-rose-600/25 bg-rose-50/40"
            : "border-emerald-600/25 bg-emerald-50/40",
        )}
      >
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          {rejected ? (
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-ink-900">
                {rejected
                  ? `Rejected — ${outcome.rejectCodes.join(", ")}`
                  : "Paid"}
              </h2>
              <Badge tone="neutral">{outcome.channel}</Badge>
              <Badge tone="neutral">{outcome.brandGeneric}</Badge>
              {outcome.formularyLevel ? (
                <Badge tone="neutral">Level {outcome.formularyLevel}</Badge>
              ) : null}
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-700">
              {rejected
                ? (outcome.rejectMessage ?? "") +
                  ". " +
                  (REJECT_MEMBER_EXPLANATION[outcome.rejectCodes[0]] ?? "")
                : `The member pays ${formatCents(outcome.patientPayCents)} at the counter. The plan pays ${formatCents(outcome.planPaidCents)}, and the pharmacy is remitted ${formatCents(outcome.pharmacyPaidCents)}.`}
            </p>
          </div>
          {!rejected ? (
            <div className="shrink-0 text-right">
              <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
                Member pays
              </div>
              <div className="tnum text-2xl font-semibold text-ink-900">
                {formatCents(outcome.patientPayCents)}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {!rejected ? (
        <Card>
          <CardHeader
            title="What the response carried"
            description="Under a pass-through contract the amount billed to the plan and the amount allowed to the pharmacy are the same number. The difference between them is the PBM's spread, and here it is zero by construction."
          />
          <Table>
            <thead>
              <tr>
                <Th>NCPDP field</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              <Money
                label="506-F6 Ingredient cost paid"
                cents={outcome.allowedIngredientCostCents}
                note={
                  outcome.pricing
                    ? `basis ${outcome.pricing.basisOfReimbursement}: ${PRICING_ARM_LABEL[outcome.pricing.winningArm as PricingArm] ?? ""}`
                    : undefined
                }
              />
              <Money
                label="507-F7 Dispensing fee paid"
                cents={outcome.allowedDispensingFeeCents}
              />
              <Money
                label="509-F9 Total amount paid to pharmacy"
                cents={outcome.pharmacyPaidCents}
              />
              <Money
                label="505-F5 Patient pay amount"
                cents={outcome.patientPayCents}
              />
              <Money
                label="518-FI Amount of copay"
                cents={outcome.copayCoinsuranceCents}
              />
              {outcome.appliedToDeductibleCents > 0 ? (
                <Money
                  label="517-FH Applied to deductible"
                  cents={outcome.appliedToDeductibleCents}
                />
              ) : null}
              {outcome.brandSelectionPenaltyCents > 0 ? (
                <Money
                  label="Brand selection penalty (DAW)"
                  cents={outcome.brandSelectionPenaltyCents}
                />
              ) : null}
              <tr className="border-t-2 border-ink-200">
                <Td className="font-medium text-ink-900">
                  Billed to the plan
                </Td>
                <Td align="right" className="font-semibold">
                  {formatCents(outcome.totalBilledCents)}
                </Td>
              </tr>
              <tr>
                <Td className="text-ink-600">
                  PBM spread on this claim
                  <span className="ml-1.5 text-[11.5px] text-ink-500">
                    billed less allowed
                  </span>
                </Td>
                <Td
                  align="right"
                  className={
                    outcome.totalBilledCents === outcome.totalAllowedCents
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-rose-700"
                  }
                >
                  {formatCents(
                    outcome.totalBilledCents - outcome.totalAllowedCents,
                  )}
                </Td>
              </tr>
              {outcome.estimatedRebateCents > 0 ? (
                <tr>
                  <Td className="text-ink-600">
                    Manufacturer rebate passed to the plan
                  </Td>
                  <Td align="right" className="text-emerald-700">
                    &minus;{formatCents(outcome.estimatedRebateCents)}
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {!rejected && outcome.pricing ? (
        <Card>
          <CardHeader
            title="The lesser-of comparison"
            description="Every arm priced this same fill. The contract pays the lowest one, and the response carries the code for which arm that was."
            action={<SimulatedBadge />}
          />
          <Table>
            <thead>
              <tr>
                <Th>Pricing arm</Th>
                <Th align="right">Would have paid</Th>
              </tr>
            </thead>
            <tbody>
              {outcome.pricing.arms
                .filter((a) => a.applicable)
                .map((a) => {
                  const won = a.arm === outcome.pricing!.winningArm;
                  return (
                    <tr key={a.arm} className={won ? "bg-glass-50/70" : ""}>
                      <Td>
                        <span
                          className={
                            won
                              ? "font-semibold text-glass-900"
                              : "text-ink-700"
                          }
                        >
                          {PRICING_ARM_LABEL[a.arm as PricingArm] ?? a.arm}
                        </span>
                        {won ? (
                          <Badge tone="accent" className="ml-2">
                            won
                          </Badge>
                        ) : null}
                      </Td>
                      <Td align="right" className={won ? "font-semibold" : ""}>
                        {formatCents(Math.round(a.ingredientCostMicros / 10_000))}
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="The derivation"
          description="Every rule the engine evaluated on this transmission, in order. This is generated live, not looked up."
        />
        <TraceViewer steps={outcome.trace} sources={sources} />
      </Card>

      <NcpdpPanel claim={wireFormat(result)} />
    </>
  );
}

function MemberPosition({ ctx }: { ctx: PosResult["context"] }) {
  const rxPct =
    ctx.rxOopLimitCents > 0
      ? Math.min(1, ctx.rxOopAccumulatedCents / ctx.rxOopLimitCents)
      : 0;

  return (
    <Card>
      <CardHeader
        title="The member's position on that date"
        description="Rebuilt from the claims that precede the date of service, not read off the year-end balance. A fill in March has to be priced against March."
      />
      <dl className="divide-y divide-ink-100">
        <Row label="Plan" value={ctx.planName} />
        <Row
          label="Prescription out-of-pocket"
          value={`${formatCents(ctx.rxOopAccumulatedCents)} of ${formatCents(ctx.rxOopLimitCents)}`}
        />
        <Row
          label="Deductible"
          value={
            ctx.deductibleCents > 0
              ? `${formatCents(ctx.deductibleAccumulatedCents)} of ${formatCents(ctx.deductibleCents)}`
              : "none on this plan"
          }
        />
        <Row
          label="Fills before this date"
          value={
            ctx.priorFills > 0
              ? `${ctx.priorFills}, most recently ${formatDate(new Date(ctx.lastFillDate!))}`
              : "none"
          }
        />
        <Row
          label="Approved authorizations"
          value={
            ctx.approvedPAs.length > 0
              ? ctx.approvedPAs
                  .map(
                    (pa) =>
                      `${pa.drugName}${pa.through ? ` through ${pa.through}` : ""}`,
                  )
                  .join("; ")
              : "none on file"
          }
        />
      </dl>
      <div className="border-t border-ink-100 px-5 py-2.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-glass-600"
            style={{ width: `${rxPct * 100}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

function wireFormat(result: PosResult) {
  const { outcome, context } = result;
  const f = (c: number) => (c / 100).toFixed(2);
  return {
    request: {
      "101-A1 BIN Number": "610602",
      "104-A4 Processor Control Number": "NVT",
      "103-A3 Transaction Code": "B1",
      "302-C2 Cardholder ID": context.cardholderId,
      "407-D7 Product/Service ID": context.ndc11,
      "436-E1 Product/Service ID Qualifier": "03 (NDC)",
    },
    response: {
      "112-AN Transaction Response Status":
        outcome.responseStatus === "P" ? "P (Paid)" : "R (Rejected)",
      ...(outcome.responseStatus === "R"
        ? {
            "511-FB Reject Code": outcome.rejectCodes.join(", "),
            "526-FQ Additional Message": outcome.rejectMessage ?? "",
          }
        : {
            "506-F6 Ingredient Cost Paid": f(outcome.allowedIngredientCostCents),
            "507-F7 Dispensing Fee Paid": f(outcome.allowedDispensingFeeCents),
            "509-F9 Total Amount Paid": f(outcome.pharmacyPaidCents),
            "505-F5 Patient Pay Amount": f(outcome.patientPayCents),
            "518-FI Amount of Copay": f(outcome.copayCoinsuranceCents),
            "522-FM Basis of Reimbursement":
              outcome.pricing?.basisOfReimbursement ?? "",
          }),
    },
  };
}

function Money({
  label,
  cents,
  note,
}: {
  label: string;
  cents: number;
  note?: string;
}) {
  return (
    <tr>
      <Td>
        <span className="font-mono text-[11.5px] text-ink-600">{label}</span>
        {note ? (
          <span className="ml-2 text-[11.5px] text-ink-500">{note}</span>
        ) : null}
      </Td>
      <Td align="right">{formatCents(cents)}</Td>
    </tr>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2 text-[13px]">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 outline-none transition focus:border-glass-500 focus:ring-2 focus:ring-glass-500/20"
    >
      {children}
    </select>
  );
}

function Input({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tnum w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] text-ink-900 outline-none transition focus:border-glass-500 focus:ring-2 focus:ring-glass-500/20"
    />
  );
}
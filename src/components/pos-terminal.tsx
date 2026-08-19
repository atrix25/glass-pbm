"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Loader2, Send } from "lucide-react";
import { Badge, Card, CardHeader, SimulatedBadge, Table, Td, Th } from "@/components/ui";
import { TraceViewer, type TraceSource } from "@/components/trace-viewer";
import { NcpdpPanel } from "@/components/ncpdp-panel";
import { formatCents } from "@/lib/money";
import { describeFailure, postJson } from "@/lib/post-json";
import { closureOn } from "@/lib/pa/emergency-supply";
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

export interface PickerPrescriber {
  npi: string;
  name: string;
  specialty: string;
}

export interface PosScenario {
  id: string;
  label: string;
  blurb: string;
  reasonCode: string;
  severity: string;
  memberName: string;
  drugName: string;
  request: {
    memberId: string;
    drugId: string;
    pharmacyId: string;
    dateOfService: string;
    quantityDispensed: number;
    daysSupply: number;
    prescriberNpi: string | null;
    /** 418-DK, set only by presets that are about the emergency supply. */
    levelOfService?: string | null;
  };
}

interface DurConflict {
  reasonForServiceCode: string;
  reasonLabel: string;
  clinicalSignificanceCode: string;
  severity: "Major" | "Moderate" | "Minor";
  otherPharmacyIndicator: string;
  otherPharmacyLabel: string;
  previousDateOfFill: string | null;
  quantityOfPreviousFill: number | null;
  databaseIndicator: string;
  databaseLabel: string;
  otherPrescriberIndicator: string;
  otherPrescriberLabel: string;
  freeText: string;
  conflictingDrug: string | null;
  conflictingClaimNumber: string | null;
  citation: string;
  requiresIntervention: boolean;
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
  dur: DurConflict[];
  activeTherapy: {
    name: string;
    dateOfService: string;
    daysSupply: number;
    dailyMme: number | null;
    samePharmacy: boolean;
  }[];
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
  prescribers,
  scenarios,
  sources,
  defaultDate,
}: {
  members: PickerMember[];
  drugs: PickerDrug[];
  pharmacies: PickerPharmacy[];
  prescribers: PickerPrescriber[];
  scenarios: PosScenario[];
  sources: Record<string, TraceSource>;
  defaultDate: string;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [drugId, setDrugId] = useState(drugs[0]?.id ?? "");
  const [pharmacyId, setPharmacyId] = useState(pharmacies[0]?.id ?? "");
  const [prescriberNpi, setPrescriber] = useState(prescribers[0]?.npi ?? "");
  const [dateOfService, setDate] = useState(defaultDate);
  const [quantity, setQuantity] = useState(drugs[0]?.typicalQuantity ?? 30);
  const [daysSupply, setDays] = useState(drugs[0]?.typicalDaysSupply ?? 30);
  const [dawCode, setDaw] = useState("0");
  const [levelOfService, setLevelOfService] = useState("");
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

  function loadScenario(s: PosScenario) {
    setMemberId(s.request.memberId);
    setDrugId(s.request.drugId);
    setPharmacyId(s.request.pharmacyId);
    setDate(s.request.dateOfService);
    setQuantity(s.request.quantityDispensed);
    setDays(s.request.daysSupply);
    setPrescriber(s.request.prescriberNpi ?? "");
    setDaw("0");
    const los = s.request.levelOfService ?? "";
    setLevelOfService(los);
    void submit({ ...s.request, dawCode: "0", levelOfService: los || null });
  }

  async function submit(override?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await postJson<PosResult>("/api/pos", {
          memberId,
          drugId,
          pharmacyId,
          dateOfService,
          quantityDispensed: Number(quantity),
          daysSupply: Number(daysSupply),
          dawCode,
          levelOfService: levelOfService || null,
          prescriberNpi: prescriberNpi || null,
          ...override,
        }),
      );
    } catch (e) {
      setError(describeFailure(e, "Adjudication failed"));
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

            <Field label="411-DB Prescriber ID">
              <Select value={prescriberNpi} onChange={setPrescriber}>
                <option value="">Not submitted</option>
                {prescribers.map((p) => (
                  <option key={p.npi} value={p.npi}>
                    {p.name} — {p.specialty}
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

            {/*
              The emergency fill has to be asked for. A short days supply on a
              Saturday is not by itself a request for one, and the field is
              where the pharmacist's decision is recorded.
            */}
            <Field label="418-DK Level of service">
              <Select value={levelOfService} onChange={setLevelOfService}>
                <option value="">Not submitted</option>
                <option value="3">3 — Emergency</option>
              </Select>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                {levelOfService === "3"
                  ? closureLabel(dateOfService)
                    ? `${closureLabel(dateOfService)}: on a drug needing authorization, up to five days pays at no member cost share and the authorization is worked the next business day.`
                    : "A business day, so the prescriber can be reached and the emergency supply does not apply. The authorization requirement stands."
                  : "Set this to Emergency and pick a weekend or holiday date to see the authorization waived at no member cost."}
              </p>
            </Field>

            <button
              onClick={() => submit()}
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

        {scenarios.length > 0 ? (
          <Card>
            <CardHeader
              title="Conflicts the book already contains"
              description="The retrospective pass found each of these after the fact, which is how a plan normally hears about them. Transmitting the fill again shows the same finding arriving while it could still change something."
            />
            <div className="divide-y divide-ink-100">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadScenario(s)}
                  disabled={busy}
                  className="block w-full px-5 py-3 text-left transition hover:bg-glass-50/60 disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white">
                      {s.reasonCode}
                    </span>
                    <span className="text-[13px] font-medium text-ink-900">
                      {s.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
                    {s.blurb}
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink-500">
                    {s.memberName} — {s.drugName} on{" "}
                    {s.request.dateOfService}
                  </p>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

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

      {result.dur.length > 0 ? (
        <DurSegment conflicts={result.dur} therapy={result.activeTherapy} />
      ) : null}

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

/**
 * The DUR/PPS response segment.
 *
 * Worth being precise about what this is, because it is the part of the
 * transaction most often described as "a rejection" and it is not one. The
 * processor returns the conflict, the pharmacist decides, and for a major one
 * the pharmacy transmits a professional service code back before the claim
 * will pay. The money does not move on this segment.
 */
function DurSegment({
  conflicts,
  therapy,
}: {
  conflicts: DurConflict[];
  therapy: PosResult["activeTherapy"];
}) {
  const intervention = conflicts.some((c) => c.requiresIntervention);
  const mmeTotal = therapy.reduce((s, f) => s + (f.dailyMme ?? 0), 0);

  return (
    <Card
      className={cn(
        intervention ? "border-amber-600/30 bg-amber-50/40" : "border-ink-200",
      )}
    >
      <CardHeader
        title="DUR/PPS response segment"
        description="Clinical screening runs inside the same second as the pricing, against every pharmacy's claims rather than just this one's. A conflict advises; it does not reject. Where the significance code is 1, the pharmacy is expected to intervene and transmit a professional service code before the claim pays."
        action={
          <Badge tone={intervention ? "warn" : "neutral"}>
            {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
          </Badge>
        }
      />
      <div className="divide-y divide-ink-100">
        {conflicts.map((c, i) => (
          <div key={i} className="px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white">
                439-E4 {c.reasonForServiceCode}
              </span>
              <span className="text-[13px] font-semibold text-ink-900">
                {c.reasonLabel}
              </span>
              <Badge
                tone={
                  c.severity === "Major"
                    ? "negative"
                    : c.severity === "Moderate"
                      ? "warn"
                      : "neutral"
                }
              >
                528-FS {c.clinicalSignificanceCode} — {c.severity.toLowerCase()}
              </Badge>
              {c.requiresIntervention ? (
                <Badge tone="warn">intervention required</Badge>
              ) : null}
            </div>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-700">
              {c.freeText}
              {c.conflictingDrug ? (
                <span className="text-ink-500">
                  {" "}
                  Conflicting therapy: {c.conflictingDrug}
                  {c.conflictingClaimNumber
                    ? ` on claim ${c.conflictingClaimNumber}`
                    : ""}
                  .
                </span>
              ) : null}
            </p>
            {/* Fields the segment does not carry are left out rather than
                printed empty, which is how they arrive on the wire. */}
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-2">
              <WireRow
                field="529-FT Other pharmacy"
                value={`${c.otherPharmacyIndicator} — ${c.otherPharmacyLabel}`}
              />
              <WireRow
                field="533-FX Other prescriber"
                value={`${c.otherPrescriberIndicator} — ${c.otherPrescriberLabel}`}
              />
              {c.previousDateOfFill ? (
                <WireRow
                  field="530-FU Previous date of fill"
                  value={c.previousDateOfFill}
                />
              ) : null}
              {c.quantityOfPreviousFill != null ? (
                <WireRow
                  field="531-FV Quantity of previous fill"
                  value={String(c.quantityOfPreviousFill)}
                />
              ) : null}
              <WireRow
                field="532-FW Database"
                value={`${c.databaseIndicator} — ${c.databaseLabel}`}
              />
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
              {c.citation}
            </p>
          </div>
        ))}
      </div>
      {therapy.length > 0 ? (
        <div className="border-t border-ink-100 bg-ink-50/50 px-5 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-500">
            Therapy still active on this date
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-700">
            {therapy.map((f, i) => (
              <li key={i}>
                {f.name} — {f.daysSupply} days from {f.dateOfService}
                {f.dailyMme ? `, ${Math.round(f.dailyMme)} MME/day` : ""}
                {f.samePharmacy ? "" : ", another pharmacy"}
              </li>
            ))}
          </ul>
          {mmeTotal > 0 ? (
            <p className="mt-1.5 text-[11.5px] text-ink-500">
              {Math.round(mmeTotal)} morphine milligram equivalents per day
              across concurrent opioid fills, before this one.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function WireRow({ field, value }: { field: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-mono text-ink-500">{field}</dt>
      <dd className="min-w-0 text-ink-700">{value}</dd>
    </div>
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
      ...(result.dur.length > 0
        ? {
            "439-E4 Reason for Service Code": result.dur
              .map((d) => d.reasonForServiceCode)
              .join(", "),
            "528-FS Clinical Significance Code": result.dur
              .map((d) => d.clinicalSignificanceCode)
              .join(", "),
            "544-FY DUR Free Text Message": result.dur[0].freeText,
          }
        : {}),
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

/** Why a prescriber cannot be reached on the date in the form, if they cannot. */
function closureLabel(dateOfService: string): string | null {
  const parsed = new Date(`${dateOfService}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return closureOn(parsed)?.label ?? null;
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
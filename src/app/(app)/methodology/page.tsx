import Link from "next/link";
import { Database, FileWarning } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { DEFAULT_ASSUMPTIONS } from "@/lib/engine/benchmark";
import { PIPELINE_STAGES } from "@/lib/methodology";
import { getMethodologyFacts } from "@/lib/queries/methodology";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const facts = await getMethodologyFacts();

  return (
    <div className="space-y-6">
      <SectionTitle description="What in this system is real, what is transcribed from a document, and what is invented. The distinction matters more than the numbers: a claim priced off a benchmark nobody can see is not transparent no matter how many decimal places it carries.">
        Methodology
      </SectionTitle>

      {/* The three layers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Layer
          tone="real"
          title="Real, and checkable by you"
          items={[
            `NADAC unit costs for ${formatNumber(facts.pricedDrugs)} products, from the weekly CMS file`,
            `The Navitus formulary for plan year 2026: tier, prior authorization, step therapy and quantity limit flags`,
            `Contract ETG0013 Exhibit C rate card, transcribed line for line`,
            `Copays, deductibles and the $${(facts.rxOopLimitCents / 100).toFixed(0)} prescription out-of-pocket limit from the certificate of coverage`,
            `${formatNumber(facts.criteriaSteps)} numbered prior authorization criteria steps, transcribed from the published forms`,
            "Regulatory decision deadlines under 29 CFR 2560.503-1 and 42 CFR 423.568 and .572",
          ]}
        />
        <Layer
          tone="derived"
          title="Derived, with the derivation shown"
          items={[
            "AWP and WAC, because they are proprietary and unpublished",
            "MAC lists, which are the PBM's own and are never disclosed",
            "Rebate amounts, taken from the contractual minimum per brand claim rather than from confidential invoices",
            "The traditional spread comparator, priced off a real published Michigan contract but with a modeled client-side MAC",
          ]}
        />
        <Layer
          tone="invented"
          title="Invented outright"
          items={[
            `${formatNumber(facts.members)} members across ${formatNumber(facts.contracts)} subscriber contracts, with names, addresses and diagnoses`,
            `${formatNumber(facts.claims)} fills: which drug, on what day, at which pharmacy, for how many days`,
            "Pharmacy cash prices and submitted ingredient costs",
            "Prescriber names and the answers they gave on prior authorization forms",
          ]}
        />
      </div>

      <Card className="border-glass-600/25 bg-glass-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-glass-700" />
          <div>
            <h2 className="text-[14px] font-semibold text-ink-900">
              The population is invented. The adjudication of it is not.
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-700">
              Nothing in the claim ledger was written by the generator. It
              chose a member, a drug, a pharmacy and a date, and then handed
              those to the same engine a live claim would go through. Every
              paid amount, every member cost share, every reject code and every
              accumulator balance came back out of that engine. That is why a
              claim can be opened and read as a derivation rather than a
              summary, and why changing a copay and replaying the book produces
              a different answer instead of a re-labelled one.
            </p>
          </div>
        </div>
      </Card>

      {/* Pipeline */}
      <Card>
        <CardHeader
          title="The adjudication pipeline"
          description="Every claim runs these stages in this order. Each one writes its inputs, its output and the document it read into the claim's trace, which is what the proof page for a claim renders."
        />
        <Table>
          <thead>
            <tr>
              <Th>Stage</Th>
              <Th>What it decides</Th>
              <Th>Read from</Th>
            </tr>
          </thead>
          <tbody>
            {PIPELINE_STAGES.map((s) => (
              <tr key={s.id} className="hover:bg-ink-50/60">
                <Td className="whitespace-nowrap">
                  <span className="font-medium text-ink-900">{s.label}</span>
                </Td>
                <Td className="max-w-xl text-[12.5px] leading-relaxed text-ink-700">
                  {s.decides}
                </Td>
                <Td className="whitespace-nowrap text-[12.5px] text-ink-600">
                  {s.source}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Lesser of */}
      <Card>
        <CardHeader
          title="What the plan pays for the ingredient"
          description="Exhibit C prices off AWP with a MAC ceiling, capped by the pharmacy's cash price. The engine computes every applicable arm and takes the lowest, then records which arm won and by how much."
        />
        <div className="space-y-3 px-5 py-4 text-[13px] leading-relaxed text-ink-700">
          <p>
            The arms in play for this contract are the AWP discount, the MAC
            ceiling on multi-source generics, the pharmacy&apos;s usual and
            customary cash price, and the amount the pharmacy submitted. The
            cash price is compared against the all-in total rather than the
            ingredient cost alone, because a member walking in without
            insurance would pay one number, not two.
          </p>
          <p>
            NADAC is deliberately <em>not</em> an arm. It is a published
            acquisition-cost benchmark, not a term of this agreement. Including
            it would quietly cap the plan at what the pharmacy paid, erase the
            pharmacy&apos;s margin, and report savings this contract does not
            actually deliver.
          </p>
        </div>
      </Card>

      {/* AWP */}
      <div id="awp" className="scroll-mt-24" />
      <Card className="border-amber-600/30">
        <CardHeader
          title="How AWP is simulated"
          description="Average Wholesale Price is the benchmark every discount in this contract is quoted against, and it is not published. Medi-Span and First Databank license it. Exhibit C states that Medi-Span is Navitus' only source of drug pricing data and is used for all claims adjudication, which means the plan sponsor is contractually bound to a number it cannot audit."
        />
        <div className="space-y-3 px-5 py-4 text-[13px] leading-relaxed text-ink-700">
          <p>
            This system derives a stand-in from NADAC. Brand and generic use
            very different multipliers, and that is real market structure
            rather than a fudge: a pharmacy buys a brand near its wholesale
            cost, so brand AWP sits roughly a fifth above it, which is why
            brand discount guarantees are in the high teens. Generic AWP is a
            largely notional list price sitting many times above acquisition
            cost, which is why generic guarantees run in the eighties. A single
            multiplier would make the contract&apos;s own rate structure
            incoherent.
          </p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Assumption</Th>
              <Th align="right">Value</Th>
              <Th>Why</Th>
            </tr>
          </thead>
          <tbody>
            <AssumptionRow
              label="Brand AWP"
              value={`${DEFAULT_ASSUMPTIONS.awpMultiplierBrand.toFixed(2)} x NADAC`}
              why="Brand acquisition cost sits close to wholesale, so list is a modest step above it."
            />
            <AssumptionRow
              label="Generic AWP"
              value={`${DEFAULT_ASSUMPTIONS.awpMultiplierGeneric.toFixed(2)} x NADAC`}
              why="Generic list price is notional and bears little relation to what a pharmacy pays."
            />
            <AssumptionRow
              label="Specialty generic AWP"
              value={`${DEFAULT_ASSUMPTIONS.awpMultiplierSpecialtyGeneric.toFixed(2)} x NADAC`}
              why="Limited-distribution products price like brands. Applying the retail generic multiplier reported the specialty channel beating its guarantee by 23 points, which was an artifact of the assumption."
            />
            <AssumptionRow
              label="Generic MAC ceiling"
              value={`${DEFAULT_ASSUMPTIONS.macMultiplierGeneric.toFixed(2)} x NADAC`}
              why="Calibrated so the MAC list, not the AWP discount, governs most retail generic fills. That is what happens in practice."
            />
            <AssumptionRow
              label="Per-product spread"
              value={`+/- ${(DEFAULT_ASSUMPTIONS.variance * 100).toFixed(0)}%`}
              why="Hashed from the NDC, so a drug always receives the same simulated AWP and a claim replays identically."
            />
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">
            Every figure in this system that depends on these multipliers is
            badged. The{" "}
            <Link
              href="/reports#awp-sensitivity"
              className="text-glass-700 underline decoration-glass-300 underline-offset-2 hover:text-glass-900"
            >
              AWP sensitivity analysis
            </Link>{" "}
            shows how far reported guarantee performance moves when the
            multiplier does, which is the honest way to state what a plan
            sponsor loses by being unable to see the benchmark.
          </p>
        </div>
      </Card>

      {/* Population */}
      <Card>
        <CardHeader
          title="How the membership was generated"
          description="Calibrated against ET-8933, the state's published pharmacy fact sheet: 211,424 commercial participants filled 3,062,138 prescriptions costing $321,911,357 in 2025. That is 14.5 prescriptions and $1,523 per participant, and those two numbers are what the generated book is tuned to reproduce at a smaller scale."
        />
        <Table>
          <thead>
            <tr>
              <Th>Measure</Th>
              <Th align="right">This book</Th>
              <Th align="right">ET-8933</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-ink-50/60">
              <Td>Prescriptions per member per year</Td>
              <Td align="right">{facts.scriptsPerMember.toFixed(1)}</Td>
              <Td align="right">14.5</Td>
              <Td className="text-[12.5px] text-ink-600">
                Utilization profiles were fitted to this, not the reverse
              </Td>
            </tr>
            <tr className="hover:bg-ink-50/60">
              <Td>Total drug cost per member per year</Td>
              <Td align="right">
                ${facts.costPerMember.toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}
              </Td>
              <Td align="right">$1,523</Td>
              <Td className="text-[12.5px] text-ink-600">
                Falls out of the engine rather than being set
              </Td>
            </tr>
            <tr className="hover:bg-ink-50/60">
              <Td>Member share of drug spend</Td>
              <Td align="right">{(facts.memberShare * 100).toFixed(1)}%</Td>
              <Td align="right">10.6%</Td>
              <Td className="text-[12.5px] text-ink-600">
                A product of the copay schedule, not a target
              </Td>
            </tr>
            <tr className="hover:bg-ink-50/60">
              <Td>Generic dispensing rate</Td>
              <Td align="right">{(facts.genericRate * 100).toFixed(1)}%</Td>
              <Td align="right">88.0%</Td>
              <Td className="text-[12.5px] text-ink-600">
                A product of the formulary and the drug mix
              </Td>
            </tr>
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">
            Everything is drawn from a fixed seed, so the same book is produced
            every time. That is not a stylistic preference: the golden tests
            assert exact amounts on named claims, and the replay engine has to
            be able to re-adjudicate a claim years later and get the same
            answer.
          </p>
        </div>
      </Card>

      {/* Money */}
      <Card>
        <CardHeader
          title="Arithmetic"
          description="Money is never held in a floating point number. Every intermediate amount is an integer count of millionths of a dollar."
        />
        <div className="space-y-3 px-5 py-4 text-[13px] leading-relaxed text-ink-700">
          <p>
            A discount of 18.20% applied to a price with five decimal places
            does not land on a cent, and a pipeline that rounds at every step
            accumulates error that shows up as a book that does not balance.
            Amounts are carried in micros through the whole pipeline and
            rounded exactly once, at the boundary where a real payment happens.
          </p>
          <p>
            At that boundary the member&apos;s share is rounded first and the
            plan absorbs the remainder, so the two parts always sum to the
            total. Rounding both independently left a penny unaccounted for on{" "}
            {formatNumber(2011)} claims. The invariant suite asserts the
            identity on every claim in the book.
          </p>
        </div>
      </Card>

      {/* Limitations */}
      <Card className="border-rose-600/25">
        <CardHeader
          title="What this does not establish"
          description="The limitations that would matter if this were run for a real plan, stated plainly rather than left for someone to find."
        />
        <ul className="divide-y divide-ink-100">
          {LIMITATIONS.map((l) => (
            <li key={l.title} className="flex gap-3 px-5 py-3.5">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <p className="text-[13px] font-medium text-ink-900">
                  {l.title}
                </p>
                <p className="mt-0.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-600">
                  {l.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const LIMITATIONS = [
  {
    title: "The membership is not the Wisconsin membership",
    detail:
      "Adjudicating a generated population perfectly says nothing about how this would price the real one. It demonstrates that the rules are implemented and the arithmetic holds, which is a claim about the engine and not about the program.",
  },
  {
    title: "Only one rate card is fully published",
    detail:
      "Exhibit C covers 2019. The order of precedence in the contract references Exhibits D and E for later years, but those amendment PDFs are image-only cover pages with no exhibit attached. The 2019 rates are used throughout and labelled as such.",
  },
  {
    title: "Three prior authorization forms of 438 are transcribed",
    detail:
      "The rest are catalogued with their document identifiers so the gap is visible. A drug with no transcribed form escalates to a pharmacist rather than being guessed at, and that behaviour is tested.",
  },
  {
    title: "Rebates are the contractual floor, not the invoice",
    detail:
      "Manufacturer rebate rates are confidential. What is modeled is the minimum per brand claim the contract guarantees, so the rebate figures are a lower bound on what a real book would collect rather than an estimate of it.",
  },
  {
    title: "The formulary is parsed to page 106",
    detail:
      "That is the end of the alphabetical index, which is the part carrying tier and utilization management flags. The remaining pages are appendices and are not read.",
  },
  {
    title: "The drug price join is fuzzy at the margin",
    detail:
      "NADAC and the formulary sometimes name the same product differently. Most products match on ingredient, form and release; a minority match on ingredient alone, which can attach a tablet's price to a solution. The tier each match was made at is recorded rather than assumed away.",
  },
  {
    title: "The proof page reports a stored test run",
    detail:
      "It reads the artifact the suite last wrote. It does not run the tests inside a request, so it can never report a greener result than the tests actually produced, but it can report a stale one.",
  },
  {
    title: "The MAC list moves only when an appeal moves it",
    detail:
      "Ceilings are derived from a single NADAC snapshot, so the weekly versions carry identical base prices and the only recorded movements are adjustments won by pharmacies on appeal. A real list would also move every week as the survey does.",
  },
  {
    title: "The service incident is modelled, not observed",
    detail:
      "One four-day degradation is written into the year so the guarantee machinery has something to fire on. The delays it produced are real records with real dates and the credit is computed from them, but the event itself was authored.",
  },
  {
    title: "The throughput benchmark is one machine and one process",
    detail:
      "It measures the engine on a laptop core against this book, with no network, no clustered database and no failover. What it establishes is that compute is not the barrier, which is a narrower claim than being production ready.",
  },
] as const;

function Layer({
  tone,
  title,
  items,
}: {
  tone: "real" | "derived" | "invented";
  title: string;
  items: string[];
}) {
  const badge = {
    real: { label: "verifiable", cls: "positive" as const },
    derived: { label: "derived", cls: "warn" as const },
    invented: { label: "synthetic", cls: "negative" as const },
  }[tone];

  return (
    <Card className="flex flex-col">
      <div className="border-b border-ink-200/70 px-5 py-3.5">
        <Badge tone={badge.cls}>{badge.label}</Badge>
        <h2 className="mt-2 text-[13.5px] font-semibold tracking-tight text-ink-900">
          {title}
        </h2>
      </div>
      <ul className="flex-1 space-y-2 px-5 py-4">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2 text-[12.5px] leading-relaxed text-ink-700"
          >
            <span
              aria-hidden
              className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-ink-400"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AssumptionRow({
  label,
  value,
  why,
}: {
  label: string;
  value: string;
  why: string;
}) {
  return (
    <tr className="hover:bg-ink-50/60">
      <Td className="whitespace-nowrap font-medium text-ink-900">{label}</Td>
      <Td align="right" className="whitespace-nowrap">
        {value}
      </Td>
      <Td className="max-w-xl text-[12.5px] leading-relaxed text-ink-600">
        {why}
      </Td>
    </tr>
  );
}

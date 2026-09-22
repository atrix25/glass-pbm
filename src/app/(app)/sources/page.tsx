import { FileText, Lock } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { listSources, type SourceUsage } from "@/lib/queries/sources";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  contract: "Contract",
  benefit: "Benefit design",
  formulary: "Formulary",
  "pa-criteria": "Prior authorization criteria",
  "price-file": "Price file",
  audit: "Independent audit",
  statute: "Statute and regulation",
  report: "Published plan statistics",
};

/** The order a reader would want: what the plan bought, then how it is run. */
const KIND_ORDER = [
  "contract",
  "benefit",
  "formulary",
  "price-file",
  "pa-criteria",
  "audit",
  "report",
  "statute",
];

export default async function SourcesPage() {
  const sources = await listSources();

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind] ?? kind,
    docs: sources.filter((s) => s.kind === kind),
  })).filter((g) => g.docs.length > 0);

  const withHash = sources.filter((s) => s.contentHash).length;
  const loadedFrom = sources.filter((s) => s.configuredRows > 0).length;

  return (
    <div className="space-y-6">
      <SectionTitle description={"Source documents and the rates, rules and decisions that reference them."}>
        Source documents
      </SectionTitle>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Documents on file"
            value={formatNumber(sources.length)}
            sub={`${grouped.length} categories`}
          />
          <Stat
            label="Configured from"
            value={formatNumber(loadedFrom)}
            sub="Documents that something was actually loaded out of"
          />
          <Stat
            label="Byte-for-byte cached"
            value={formatNumber(withHash)}
            sub="Stored with a SHA-256 of the retrieved file"
          />
          <Stat
            label="Proprietary benchmarks"
            value="1"
            tone="negative"
            sub="AWP is modeled, because it is not published"
          />
        </div>
      </Card>

      <Card className="border-amber-600/25 bg-amber-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="text-[14px] font-semibold text-ink-900">
              What could not be sourced
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-700">
              Average Wholesale Price and Wholesale Acquisition Cost are the
              benchmarks the contract discounts are quoted against, and neither
              is published. They are licensed from Medi-Span and First
              Databank. This system derives them from NADAC using a stated
              multiplier, and every figure that depends on the derivation is
              marked in the interface. Rebate invoices are likewise
              confidential, so rebates are modeled from the guaranteed minimums
              printed in the contract rather than from what was actually
              collected.
            </p>
          </div>
        </div>
      </Card>

      {grouped.map((group) => (
        <Card key={group.kind}>
          <CardHeader
            title={group.label}
            description={DESCRIPTIONS[group.kind]}
          />
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Publisher</Th>
                <Th>As printed</Th>
                <Th align="right">Rows loaded</Th>
                <Th align="right">Citations on file</Th>
              </tr>
            </thead>
            <tbody>
              {group.docs.map((doc) => (
                <SourceRow key={doc.id} doc={doc} />
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
    </div>
  );
}

const DESCRIPTIONS: Record<string, string> = {
  contract:
    "The agreement itself. Dispensing fees, discount guarantees, rebate minimums and the pass-through obligation all come from these.",
  benefit:
    "What the member is entitled to: copay tiers, deductibles, the out-of-pocket limit and the preventive drug list.",
  formulary:
    "The published drug file, with tier, prior authorization, step therapy and quantity limit flags for every covered product.",
  "price-file":
    "Unit costs. NADAC is a public survey of what pharmacies actually pay. AWP is not public, and is modeled here.",
  "pa-criteria":
    "Numbered decision trees with explicit transitions and terminal outcomes. These are what the criteria engine walks.",
  audit:
    "Independent reviews of the incumbent's performance against this contract, used to sanity-check the simulated book.",
  report:
    "The state's own published statistics for the plan, used as the target the generated population is reconciled against.",
  statute:
    "The deadlines and notice requirements a prior authorization decision has to meet. These are cited on the decision clock of every request rather than stored as a row, so they show no count here.",
};

function SourceRow({ doc }: { doc: SourceUsage }) {
  return (
    <tr className="hover:bg-ink-50/60">
      <Td>
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-start gap-1.5"
        >
          <FileText className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span>
            <span className="font-medium text-glass-700 underline decoration-glass-300 underline-offset-2 group-hover:text-glass-900 group-hover:decoration-glass-500">
              {doc.title}
            </span>
            {doc.locator ? (
              <span className="ml-1.5 text-[12px] text-ink-500">
                {doc.locator}
              </span>
            ) : null}
            {doc.notes ? (
              <span className="mt-0.5 block max-w-xl text-[12px] leading-snug text-ink-500">
                {doc.notes}
              </span>
            ) : null}
          </span>
        </a>
      </Td>
      <Td className="text-[12.5px] text-ink-600">{doc.publisher}</Td>
      <Td className="whitespace-nowrap text-[12.5px] text-ink-600">
        {doc.publishedDate ?? "undated"}
      </Td>
      <Td align="right">
        {doc.configuredRows > 0 ? (
          formatNumber(doc.configuredRows)
        ) : (
          <span className="text-ink-400">reference only</span>
        )}
      </Td>
      <Td align="right">
        {doc.citations > 0 ? (
          <Badge tone="positive">{formatNumber(doc.citations)}</Badge>
        ) : (
          <span className="text-ink-400">&mdash;</span>
        )}
      </Td>
    </tr>
  );
}

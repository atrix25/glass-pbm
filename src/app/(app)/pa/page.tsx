import Link from "next/link";
import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
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
import { getPriorAuthQueueStats, listPriorAuths } from "@/lib/queries/pa";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PriorAuthQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const [stats, rows] = await Promise.all([
    getPriorAuthQueueStats(),
    listPriorAuths({ status: params.status }),
  ]);

  return (
    <div className="space-y-5">
      <SectionTitle description="Every determination here was produced by walking a published Navitus criteria form, question by question, and every one records the numbered step that decided it. A reviewer can open the PDF and check step 7 against step 7.">
        Prior authorization
      </SectionTitle>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Requests on file"
            value={formatNumber(stats.total)}
            sub={`${formatNumber(stats.expedited)} marked expedited`}
          />
          <Stat
            label="Approved"
            value={formatNumber(stats.approved)}
            tone="positive"
            sub={`${((stats.approved / Math.max(1, stats.total)) * 100).toFixed(0)}% of determinations`}
          />
          <Stat
            label="Denied"
            value={formatNumber(stats.denied)}
            tone="negative"
            sub="Each cites the step that stopped it"
          />
          <Stat
            label="Signed by a pharmacist"
            value={formatNumber(stats.byHuman)}
            sub="Automation may confirm criteria are met; it may not deny"
          />
        </div>
      </Card>

      <Card className="border-glass-600/25 bg-glass-50/40">
        <div className="flex items-start gap-3.5 px-5 py-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-glass-700" />
          <div>
            <h2 className="text-[13.5px] font-semibold text-glass-900">
              Why these decisions are checkable and most PA decisions are not
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-glass-900/75">
              Navitus publishes its commercial criteria as numbered decision
              trees with explicit transitions and explicit terminal outcomes
              carrying approval durations. That structure is machine-evaluable
              without interpretation. This system encodes the trees by hand,
              walks them, and stores the path. It does not ask a language model
              whether a member should get a drug.{" "}
              <Link
                href="/proof#pa"
                className="font-medium underline decoration-glass-600/40 underline-offset-2 hover:decoration-glass-700"
              >
                See the branch coverage
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Determination queue"
          description="Newest first. Open any row to see the traversal."
          action={
            <div className="flex gap-1.5">
              <FilterChip label="All" href="/pa" active={!params.status} />
              <FilterChip
                label="Approved"
                href="/pa?status=Approved"
                active={params.status === "Approved"}
              />
              <FilterChip
                label="Denied"
                href="/pa?status=Denied"
                active={params.status === "Denied"}
              />
            </div>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Member</Th>
              <Th>Drug</Th>
              <Th>Determination</Th>
              <Th align="right">Deciding step</Th>
              <Th align="right">Received</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="transition hover:bg-ink-50/70">
                <Td>
                  <Link
                    href={`/pa/${r.id}`}
                    className="tnum font-medium text-ink-900 hover:text-glass-700"
                  >
                    {r.paNumber}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {r.urgency === "Expedited" ? (
                      <Badge tone="warn">expedited</Badge>
                    ) : null}
                    <span className="text-[11.5px] text-ink-500">
                      {r.tree?.name ?? "No encoded criteria"}
                    </span>
                  </div>
                </Td>
                <Td>
                  <Link
                    href={`/members/${r.member.id}`}
                    className="hover:text-glass-700"
                  >
                    {r.member.firstName} {r.member.lastName}
                  </Link>
                </Td>
                <Td>
                  <span className="truncate">{r.drug.name}</span>
                </Td>
                <Td>
                  <Determination value={r.determination} />
                </Td>
                <Td align="right" className="tnum">
                  {r.decidingStepNumber ? (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11.5px] font-medium text-ink-700">
                      step {r.decidingStepNumber}
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
                <Td align="right" className="text-ink-500">
                  {formatDate(r.receivedAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-ink-500">
            No requests match this filter.
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Determination({ value }: { value: string | null }) {
  if (value === "Approved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approved
      </span>
    );
  }
  if (value === "Denied") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-rose-700">
        <XCircle className="h-3.5 w-3.5" />
        Denied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500">
      <Clock className="h-3.5 w-3.5" />
      {value ?? "In review"}
    </span>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-lg bg-ink-900 px-2.5 py-1 text-[12px] font-medium text-white"
          : "rounded-lg border border-ink-200 px-2.5 py-1 text-[12px] text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
      }
    >
      {label}
    </Link>
  );
}

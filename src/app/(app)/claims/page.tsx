import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  SectionTitle,
  SimulatedBadge,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { ClaimFilters } from "@/components/claim-filters";
import { listClaims, type ClaimListRow } from "@/lib/queries/claims";
import { getClock } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { formatDate, formatNumber, levelMeta } from "@/lib/utils";

export const dynamic = "force-dynamic";

/*
 * Short forms of the pricing arm names, for the ledger only.
 *
 * The full names are right on a claim's derivation, where there is one of
 * them and room to read it. In a nine-column ledger they wrap to two lines on
 * most rows, which makes the row heights ragged and the column hard to scan
 * for the thing that actually matters: which arm won.
 */
const BASIS_LABEL: Record<string, string> = {
  "3": "AWP discount",
  "7": "MAC ceiling",
  "20": "NADAC",
  "5": "Usual & customary",
  "1": "Submitted cost",
};

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  };

  const clock = await getClock();
  const result = await listClaims(
    {
      q: str("q"),
      status: str("status"),
      channel: str("channel"),
      level: str("level"),
      reject: str("reject"),
      drug: str("drug"),
      member: str("member"),
      scenario: str("scenario"),
      basis: str("basis"),
      page: Number(str("page") ?? 1),
    },
    clock,
  );

  const markup =
    result.sums.nadacTotalCents > 0
      ? result.sums.totalBilledCents / result.sums.nadacTotalCents
      : 0;

  return (
    <div className="space-y-5">
      <SectionTitle description="Every claim the engine has adjudicated, paid and rejected. Open one to see the rules that fired, the benchmarks they read, and the published document behind each.">
        Claim ledger
      </SectionTitle>

      <Suspense fallback={<div className="h-9" />}>
        <ClaimFilters />
      </Suspense>

      <Card>
        <div className="grid divide-x divide-ink-200/70 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Claims in view"
            value={formatNumber(result.total)}
            sub={`page ${result.page} of ${formatNumber(result.pages)}`}
          />
          <Stat
            label="Billed to plan"
            value={formatCents(result.sums.totalBilledCents)}
            sub={`${formatCents(result.sums.planPaidCents)} plan, ${formatCents(result.sums.patientPayCents)} member`}
          />
          <Stat
            label="Pharmacy acquisition cost"
            value={formatCents(result.sums.nadacTotalCents)}
            sub="CMS NADAC, summed over the same claims"
          />
          <Stat
            label="Paid versus acquisition"
            value={markup ? `${markup.toFixed(3)}×` : "—"}
            tone="accent"
            sub="What the plan paid for every dollar of drug the pharmacy bought"
          />
        </div>
      </Card>

      <Card>
        {result.rows.length === 0 ? (
          <EmptyState
            title="No claims match these filters"
            description="Try clearing the search box or widening the status filter."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Member</Th>
                <Th>Drug</Th>
                <Th>Pharmacy</Th>
                <Th align="center">Level</Th>
                <Th align="right">Plan cost</Th>
                <Th align="right">Member</Th>
                <Th>Priced by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((c) => (
                <ClaimRow key={c.id} claim={c} />
              ))}
            </tbody>
          </Table>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          params={sp as Record<string, string>}
        />
      </Card>
    </div>
  );
}

function ClaimRow({ claim: c }: { claim: ClaimListRow }) {
  const rejected = c.responseStatus === "R";
  const rejectCode = (() => {
    try {
      return (JSON.parse(c.rejectCodes) as string[])[0];
    } catch {
      return undefined;
    }
  })();
  const meta = levelMeta(c.formularyLevel);

  return (
    <tr className="group transition hover:bg-glass-50/40">
      <Td>
        <Link href={`/claims/${c.id}`} className="block">
          <span className="tnum font-medium text-ink-900 group-hover:text-glass-700">
            {c.claimNumber}
          </span>
          <span className="block whitespace-nowrap text-[11.5px] text-ink-500">
            {formatDate(c.dateOfService)} · {c.channel}
          </span>
        </Link>
      </Td>
      <Td>
        <Link
          href={`/members/${c.member.id}`}
          className="whitespace-nowrap text-ink-800 hover:text-glass-700"
        >
          {c.member.firstName} {c.member.lastName}
        </Link>
      </Td>
      <Td>
        <span className="line-clamp-1 max-w-[240px] text-ink-800">
          {c.drug.name}
        </span>
        <span className="block text-[11.5px] text-ink-500">
          {c.quantityDispensed} units · {c.daysSupply} days
          {c.dawCode !== "0" ? ` · DAW ${c.dawCode}` : ""}
        </span>
      </Td>
      <Td>
        <span className="block w-[11.5rem] truncate whitespace-nowrap text-[12.5px] text-ink-600">
          {c.pharmacy.name}
        </span>
      </Td>
      <Td align="center">
        {rejected ? (
          <Badge tone="negative" className="tnum">
            {rejectCode ?? "R"}
          </Badge>
        ) : (
          <Badge className={meta.className}>{meta.short}</Badge>
        )}
      </Td>
      <Td align="right">
        {rejected ? (
          <span className="text-ink-400">—</span>
        ) : (
          <span className="font-medium">{formatCents(c.totalBilledCents)}</span>
        )}
      </Td>
      <Td align="right">
        {rejected ? (
          <span className="text-ink-400">—</span>
        ) : (
          formatCents(c.patientPayCents)
        )}
      </Td>
      <Td>
        {rejected ? (
          <span className="block max-w-[15rem] truncate text-[12px] text-rose-700">
            {c.rejectMessage}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-[12px] text-ink-600">
              {BASIS_LABEL[c.basisOfReimbursement ?? ""] ?? "—"}
            </span>
            {c.basisOfReimbursement === "3" ? <SimulatedBadge /> : null}
          </span>
        )}
      </Td>
      <Td align="right">
        <Link
          href={`/claims/${c.id}`}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-glass-700 opacity-0 transition group-hover:opacity-100 hover:bg-glass-50"
        >
          Proof
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </Td>
    </tr>
  );
}

function Pagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: Record<string, string>;
}) {
  if (pages <= 1) return null;
  const link = (p: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([k]) => k !== "page") as [string, string][],
    );
    next.set("page", String(p));
    return `/claims?${next.toString()}`;
  };
  return (
    <div className="flex items-center justify-between border-t border-ink-200/70 px-5 py-3 text-[12.5px]">
      <span className="text-ink-500">
        Page {page} of {formatNumber(pages)}
      </span>
      <div className="flex gap-1.5">
        {page > 1 ? (
          <Link
            href={link(page - 1)}
            className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-medium text-ink-700 transition hover:border-ink-300"
          >
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link
            href={link(page + 1)}
            className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-medium text-ink-700 transition hover:border-ink-300"
          >
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

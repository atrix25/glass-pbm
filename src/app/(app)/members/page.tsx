import Link from "next/link";
import { Search } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { listMembers } from "@/lib/queries/members";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import { formatCents } from "@/lib/money";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = Number(typeof sp.page === "string" ? sp.page : 1);
  const sort = sp.sort === "name" ? ("name" as const) : ("spend" as const);

  const { rows, total, pages } = await listMembers({ q, page, sort });

  return (
    <div className="space-y-5">
      <SectionTitle description="A synthetic population of 2,488 covered lives, generated to match the age, utilization, and spend distribution published in the ET-8933 pharmacy benefits fact sheet. Every claim on every member ran through the same engine.">
        Membership
      </SectionTitle>

      <Card>
        <CardHeader
          title="Scripted demonstration members"
          description="Four members exist so a specific, checkable story is always on screen. Their claims run through the real engine; only the inputs are scripted."
        />
        <div className="grid gap-px bg-ink-200/60 sm:grid-cols-2">
          {DEMO_MEMBER_STORIES.map((m) => (
            <Link
              key={m.id}
              href={`/members/${m.id}`}
              className="group bg-white px-5 py-4 transition hover:bg-glass-50/50"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-ink-900 group-hover:text-glass-800">
                  {m.name}
                </span>
                <Badge tone="accent">{m.tag}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
                {m.story}
              </p>
            </Link>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <form action="/members" className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Name or member ID"
            className="w-[280px] rounded-lg border border-ink-200 bg-white py-[7px] pl-8 pr-3 text-[13px] outline-none transition placeholder:text-ink-400 focus:border-glass-400 focus:ring-2 focus:ring-glass-100"
          />
        </form>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-ink-500">{formatNumber(total)} members</span>
          <Link
            href={`/members?sort=${sort === "spend" ? "name" : "spend"}${q ? `&q=${q}` : ""}`}
            className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-medium text-ink-700 transition hover:border-ink-300"
          >
            Sort by {sort === "spend" ? "name" : "spend"}
          </Link>
        </div>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Member ID</Th>
              <Th>Plan</Th>
              <Th align="right">Paid claims</Th>
              <Th align="right">Rejects</Th>
              <Th align="right">Plan cost</Th>
              <Th align="right">Out of pocket</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="group transition hover:bg-glass-50/40">
                <Td>
                  <Link
                    href={`/members/${m.id}`}
                    className="font-medium text-ink-900 group-hover:text-glass-700"
                  >
                    {m.firstName} {m.lastName}
                  </Link>
                  {m.isDemo ? (
                    <Badge tone="accent" className="ml-1.5">
                      demo
                    </Badge>
                  ) : null}
                  {m.city ? (
                    <span className="block text-[11.5px] text-ink-500">
                      {m.city}, WI
                    </span>
                  ) : null}
                </Td>
                <Td className="tnum text-[12.5px] text-ink-600">
                  {m.cardholderId}-{m.personCode}
                </Td>
                <Td className="text-[12.5px] text-ink-600">{m.planName}</Td>
                <Td align="right">{formatNumber(m.claims)}</Td>
                <Td align="right" className={m.rejects ? "text-rose-700" : "text-ink-400"}>
                  {m.rejects || "—"}
                </Td>
                <Td align="right">{formatCents(m.billedCents)}</Td>
                <Td align="right">{formatCents(m.memberPaidCents)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-200/70 px-5 py-3 text-[12.5px]">
            <span className="text-ink-500">
              Page {page} of {formatNumber(pages)}
            </span>
            <div className="flex gap-1.5">
              {page > 1 ? (
                <Link
                  href={`/members?page=${page - 1}&sort=${sort}${q ? `&q=${q}` : ""}`}
                  className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-medium text-ink-700 hover:border-ink-300"
                >
                  Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link
                  href={`/members?page=${page + 1}&sort=${sort}${q ? `&q=${q}` : ""}`}
                  className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-medium text-ink-700 hover:border-ink-300"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

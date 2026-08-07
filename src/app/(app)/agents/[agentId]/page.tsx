import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  IncumbentNote,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  getAgentDetail,
  getLatestPlanDesign,
  type RunRow,
} from "@/lib/queries/agents";
import { AUTONOMY_MEANING, type Autonomy } from "@/lib/agents/registry";
import { getClock } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { IntakeDemo } from "@/components/intake-demo";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TONE: Record<Autonomy, "neutral" | "warn" | "positive" | "negative"> = {
  Propose: "neutral",
  ActWithReview: "warn",
  Act: "positive",
  Suspended: "negative",
};

const OUTCOME_TONE: Record<string, "positive" | "warn" | "neutral" | "negative"> =
  {
    Completed: "positive",
    Escalated: "warn",
    Refused: "neutral",
    Failed: "negative",
  };

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const clock = await getClock();
  const detail = await getAgentDetail(agentId, clock);
  if (!detail) notFound();

  const { summary, policy, recent, escalations } = detail;
  const def = summary.def;

  const planDesign =
    agentId === "plan-design" ? await getLatestPlanDesign(clock) : null;

  const intakeSample =
    agentId === "pa-intake"
      ? await prisma.clinicalNote.findMany({
          select: { paId: true, channel: true, author: true },
          orderBy: { receivedAt: "desc" },
          take: 12,
        })
      : [];
  const intakeLabels =
    intakeSample.length > 0
      ? await prisma.priorAuthorization.findMany({
          where: { id: { in: intakeSample.map((n) => n.paId) } },
          select: { id: true, paNumber: true, drug: { select: { name: true } } },
        })
      : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/agents"
          className="text-[12.5px] text-glass-700 hover:text-glass-900"
        >
          ← Agent operations
        </Link>
      </div>

      <SectionTitle description={def.purpose}>{def.name}</SectionTitle>

      {agentId === "data-agent" ? (
        <p className="text-[13px] text-ink-600">
          Live chat surface:{" "}
          <Link
            href="/data-agent"
            className="font-medium text-glass-700 hover:text-glass-900"
          >
            Open the data agent
          </Link>
          .
        </p>
      ) : null}
      {agentId === "member-service" ? (
        <p className="text-[13px] text-ink-600">
          Live chat surface:{" "}
          <Link
            href="/assistant"
            className="font-medium text-glass-700 hover:text-glass-900"
          >
            Open AI member service
          </Link>
          .
        </p>
      ) : null}

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Autonomy"
            value={<Badge tone={TONE[summary.autonomy]}>{summary.autonomy}</Badge>}
            sub={AUTONOMY_MEANING[summary.autonomy]}
          />
          <Stat label="Runs" value={formatNumber(summary.runs)} sub={`Last on ${summary.lastRunAt ? formatDate(summary.lastRunAt) : "—"}`} />
          <Stat
            label="Sent to a person"
            value={
              summary.runs === 0
                ? "—"
                : `${(((summary.escalated + summary.refused) / summary.runs) * 100).toFixed(1)}%`
            }
            sub={`${formatNumber(summary.escalated + summary.refused)} runs where it declined to act`}
            tone="accent"
          />
          <Stat
            label="Median run"
            value={summary.runs === 0 ? "—" : `${formatNumber(summary.medianMs)} ms`}
            sub={`95th percentile ${formatNumber(summary.p95Ms)} ms`}
          />
        </div>
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Owned by
            </div>
            <p className="mt-1 text-[13px] text-ink-800">{def.owner}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">
              Measured on {def.measure.name.toLowerCase()}, against a target of{" "}
              {def.measure.target}.
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">
              Tools it may call
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {def.tools.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">
              Anything not on this list is refused by the runtime, so a prompt
              cannot talk it into reaching somewhere else.
            </p>
          </div>
        </div>
      </Card>

      <IncumbentNote>
        {def.incumbent.charAt(0).toUpperCase() + def.incumbent.slice(1)}. This
        agent has run {formatNumber(summary.runs)} times against this book at a
        median of {formatNumber(summary.medianMs)} milliseconds.
      </IncumbentNote>

      <Card>
        <CardHeader
          title="What it may never do"
          description="These hold at every autonomy level. The two enforcement points are different: the tool list is checked when a tool is called, and the consequential actions are checked when a proposal is written."
        />
        <ul className="divide-y divide-ink-100">
          {def.mayNot.map((m) => (
            <li key={m} className="px-5 py-3 text-[13px] leading-relaxed text-ink-700">
              {m}
            </li>
          ))}
        </ul>
        {def.consequential.length > 0 ? (
          <div className="border-t border-ink-200/70 bg-ink-50/50 px-5 py-3">
            <span className="text-[12px] text-ink-600">
              Held for a person whatever the policy says:{" "}
              {def.consequential.map((c) => (
                <code
                  key={c}
                  className="mx-0.5 rounded bg-white px-1 py-0.5 text-[11.5px] ring-1 ring-inset ring-ink-200"
                >
                  {c}
                </code>
              ))}
            </span>
          </div>
        ) : null}
      </Card>

      {agentId === "pa-intake" ? (
        <IntakeDemo
          options={intakeSample.map((n) => {
            const pa = intakeLabels.find((p) => p.id === n.paId);
            return {
              paId: n.paId,
              label: `${pa?.paNumber ?? n.paId} · ${pa?.drug.name ?? "unknown product"}`,
              channel: n.channel,
            };
          })}
        />
      ) : null}

      {planDesign ? (
        <Card>
          <CardHeader
            title="The latest recommendation, and what it cost to produce"
            description={`Run on ${formatDate(planDesign.at)}. Each option below was scored by re-adjudicating every claim in the book against it. The saving and the shift are separate columns because they are separate things.`}
            action={
              <Link
                href={`/agents/runs/${planDesign.runId}`}
                className="text-[12.5px] text-glass-700 hover:text-glass-900"
              >
                Full trace →
              </Link>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Option</Th>
                <Th>Lever</Th>
                <Th align="right">Plan saving</Th>
                <Th align="right">Moved to members</Th>
                <Th align="right">Leaves the system</Th>
                <Th align="right">Members paying more</Th>
                <Th align="right">Fills rejected</Th>
              </tr>
            </thead>
            <tbody>
              {planDesign.scored.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="font-medium">{s.name}</div>
                    <div className="mt-0.5 max-w-lg text-[12px] leading-snug text-ink-500">
                      {s.description}
                    </div>
                  </Td>
                  <Td>{s.lever}</Td>
                  <Td align="right">{formatCents(s.planSavingCents)}</Td>
                  <Td align="right" className="text-rose-700">
                    {s.memberShiftCents > 0
                      ? formatCents(s.memberShiftCents)
                      : "—"}
                  </Td>
                  <Td
                    align="right"
                    className={
                      s.netSystemSavingCents > 0
                        ? "font-medium text-emerald-700"
                        : "text-ink-500"
                    }
                  >
                    {formatCents(s.netSystemSavingCents)}
                  </Td>
                  <Td align="right">{formatNumber(s.membersPayingMore)}</Td>
                  <Td align="right">{formatNumber(s.fillsThatWouldReject)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-ink-200/70 bg-ink-50/50 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">Held for the plan sponsor</Badge>
              <span className="text-[13px] font-medium text-ink-900">
                {planDesign.headline}
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-[12.5px] leading-relaxed text-ink-700">
              {planDesign.rationale}
            </p>
            <p className="mt-2 text-[12.5px] text-ink-600">
              Nothing here has been applied. Take any option to the{" "}
              <Link href="/changes" className="text-glass-700 hover:text-glass-900">
                change console
              </Link>{" "}
              to run it yourself and commit it.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Autonomy history"
          description="What it was allowed to do, when that changed, and on what evidence. A run is judged against the policy that was in force when it ran, not the one in force now."
        />
        <div className="divide-y divide-ink-100">
          {policy.map((p) => (
            <div key={`${p.autonomy}-${p.from.toISOString()}`} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[p.autonomy as Autonomy]}>{p.autonomy}</Badge>
                <span className="text-[12.5px] text-ink-600">
                  {formatDate(p.from)} to {p.to ? formatDate(p.to) : "now"}
                </span>
                <span className="text-[12.5px] text-ink-500">· set by {p.setBy}</span>
              </div>
              <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-700">
                {p.rationale}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {escalations.length > 0 ? (
        <Card>
          <CardHeader
            title="Where it stopped"
            description="The runs where the agent declined to act. This is the half of the log worth reading: an agent that never escalates is not being careful, it is guessing."
          />
          <RunTable rows={escalations} />
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Recent runs"
          description={`${formatNumber(summary.runs)} recorded. Every one has a full trace: the tools it called, why it called them, and what came back.`}
        />
        {recent.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="This agent has not been invoked against the current book."
          />
        ) : (
          <RunTable rows={recent} />
        )}
      </Card>
    </div>
  );
}

function RunTable({ rows }: { rows: RunRow[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>What it was asked</Th>
          <Th>What happened</Th>
          <Th align="right">Steps</Th>
          <Th align="right">Took</Th>
          <Th>Outcome</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-ink-50/60">
            <Td className="whitespace-nowrap">{formatDate(r.startedAt)}</Td>
            <Td className="max-w-xs">
              <Link
                href={`/agents/runs/${r.id}`}
                className="line-clamp-2 text-glass-700 hover:text-glass-900"
                title={r.goal}
              >
                {r.goal}
              </Link>
            </Td>
            <Td className="max-w-md">
              <span className="line-clamp-2 text-[12.5px] text-ink-700" title={r.summary}>
                {r.summary}
              </span>
              {r.held ? (
                <Badge tone="warn" className="mt-1">
                  held for a person
                </Badge>
              ) : null}
            </Td>
            <Td align="right">{r.steps}</Td>
            <Td align="right">{formatNumber(r.elapsedMs)} ms</Td>
            <Td>
              <Badge tone={OUTCOME_TONE[r.outcome] ?? "neutral"}>{r.outcome}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

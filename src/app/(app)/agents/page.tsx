import Link from "next/link";
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
import { getFleet, type AgentSummary } from "@/lib/queries/agents";
import { AUTONOMY_MEANING, type Autonomy } from "@/lib/agents/registry";
import { getClock } from "@/lib/session";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TONE: Record<Autonomy, "neutral" | "warn" | "positive" | "negative"> = {
  Propose: "neutral",
  ActWithReview: "warn",
  Act: "positive",
  Suspended: "negative",
};

function dollars(millicents: number): string {
  const dollarsValue = millicents / 100_000;
  if (dollarsValue < 1) return `${(millicents / 1000).toFixed(1)}¢`;
  return `$${dollarsValue.toFixed(2)}`;
}

export default async function AgentsPage() {
  const clock = await getClock();
  const fleet = await getFleet(clock);
  const active = fleet.agents.filter((a) => a.runs > 0);

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`${fleet.agents.length} registered agents · ${formatNumber(fleet.totalRuns)} recorded runs on the synthetic reference book. Open an agent to inspect its responsibility, permissions and history.`}
      >
        Agent operations
      </SectionTitle>

      <Card>
        <div className="grid grid-cols-2 divide-x divide-ink-200/70 border-b border-ink-200/70 md:grid-cols-4">
          <Stat
            label="Runs recorded"
            value={formatNumber(fleet.totalRuns)}
            sub={`Across ${active.length} agents in the reference book`}
          />
          <Stat
            label="Consequential proposals"
            value={formatNumber(fleet.totalHeld)}
            sub="Historical total, including resolved proposals. Not a pending-work count."
            tone="accent"
          />
          <Stat
            label="Estimated staff hours"
            value={formatNumber(Math.round(fleet.hoursDisplaced))}
            sub="Modeled task time, not measured staffing savings."
          />
          <Stat
            label="Model spend"
            value={fleet.totalCostMillicents > 0 ? dollars(fleet.totalCostMillicents) : "$0.00"}
            sub={
              fleet.modelConfigured
                ? `${formatNumber(fleet.modelRuns)} runs used a language model`
                : "No API key configured: the scripted planners ran"
            }
          />
        </div>

        <details className="px-5 py-4 text-[13px] text-ink-600"><summary className="cursor-pointer font-medium">Execution detail</summary><p className="mt-2">Runs identify whether a language model or scripted planner executed the work. Calculations use deterministic tools. Recorded proposals do not establish completed actions or verified savings.</p></details>
      </Card>

      <Card>
        <CardHeader
          title="The register"
          description="What each agent is allowed to do, who decided that, and how often a person reverses it. Click through for the run log and the policy history."
        />
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Autonomy</Th>
              <Th align="right">Runs</Th>
              <Th align="right">Escalated</Th>
              <Th align="right">Consequential</Th>
              <Th align="right">Overridden</Th>
              <Th align="right">Median</Th>
              <Th>Reasoned by</Th>
            </tr>
          </thead>
          <tbody>
            {fleet.agents.map((a) => (
              <tr key={a.def.id} className="hover:bg-ink-50/60">
                <Td>
                  <Link
                    href={`/agents/${a.def.id}`}
                    className="font-medium text-glass-700 hover:text-glass-900"
                  >
                    {a.def.name}
                  </Link>
                  <div className="mt-0.5 max-w-md text-[12px] leading-snug text-ink-500">
                    {a.def.purpose}
                  </div>
                  <div className="mt-1 text-xs text-glass-700">Responsible role: {a.def.owner}</div>
                </Td>
                <Td>
                  <Badge tone={TONE[a.autonomy]}>{a.autonomy}</Badge>
                  <div className="mt-0.5 text-[11.5px] text-ink-500">
                    {a.autonomySince
                      ? `since ${formatDate(a.autonomySince)}`
                      : "registry default"}
                  </div>
                </Td>
                {a.runs === 0 ? (
                  /*
                   * An agent with nothing to show yet says why, rather than
                   * five dashes that read like a wiring fault. Program
                   * integrity screens a subject across the whole span of its
                   * fills, so its cases do not exist until that span closes,
                   * and on this date most of them have not.
                   */
                  <Td colSpan={6}>
                    <span className="text-[12px] text-ink-500">
                      {a.firstCaseAt
                        ? `No cases on this date. The first one clears its detection window on ${formatDate(a.firstCaseAt)}; advance the clock past it to see the run log fill.`
                        : "No cases on this date."}
                    </span>
                  </Td>
                ) : (
                  <>
                    <Td align="right">{formatNumber(a.runs)}</Td>
                    <Td align="right">
                      {(((a.escalated + a.refused) / a.runs) * 100).toFixed(1)}%
                    </Td>
                    <Td align="right">{formatNumber(a.held)}</Td>
                    <Td align="right">
                      {a.overrideRate === 0 && a.overridden === 0
                        ? "—"
                        : `${(a.overrideRate * 100).toFixed(1)}%`}
                    </Td>
                    <Td align="right">
                      {a.medianMs < 1 ? "under 1 ms" : `${formatNumber(a.medianMs)} ms`}
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-600">{a.brain}</span>
                    </Td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {(Object.keys(AUTONOMY_MEANING) as Autonomy[])
          .filter((k) => k !== "Suspended")
          .map((level) => {
            const at = fleet.agents.filter((a) => a.autonomy === level);
            return (
              <Card key={level}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Badge tone={TONE[level]}>{level}</Badge>
                    </span>
                  }
                  description={AUTONOMY_MEANING[level]}
                />
                <div className="px-5 py-4">
                  {at.length === 0 ? (
                    <p className="text-[13px] text-ink-500">
                      Nothing runs at this level.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {at.map((a) => (
                        <li key={a.def.id} className="text-[13px] text-ink-700">
                          <Link
                            href={`/agents/${a.def.id}`}
                            className="font-medium text-glass-700 hover:text-glass-900"
                          >
                            {a.def.name}
                          </Link>
                          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
                            {a.autonomyRationale}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
      </div>

      <Card>
        <CardHeader
          title="The line nothing crosses"
          description="Some actions are held for a person at every autonomy level, including the highest. This is enforced in the runtime rather than in a policy document, and the invariant suite checks the table afterwards to confirm no run ever got around it."
        />
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Never, whatever the policy says</Th>
            </tr>
          </thead>
          <tbody>
            {fleet.agents.map((a) => (
              <tr key={a.def.id}>
                <Td className="align-top">
                  <span className="font-medium">{a.def.name}</span>
                </Td>
                <Td>
                  <ul className="space-y-1">
                    {a.def.mayNot.map((m) => (
                      <li key={m} className="text-[12.5px] leading-snug text-ink-700">
                        {m}
                      </li>
                    ))}
                  </ul>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="What each one replaces"
          description="Priced against what an incumbent charges for the same work, from the same benchmarks used elsewhere in this build."
        />
        <div className="divide-y divide-ink-100">
          {fleet.agents.map((a) => (
            <Row key={a.def.id} agent={a} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ agent }: { agent: AgentSummary }) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_1fr_auto]">
      <div>
        <Link
          href={`/agents/${agent.def.id}`}
          className="text-[13.5px] font-medium text-glass-700 hover:text-glass-900"
        >
          {agent.def.name}
        </Link>
        <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-600">
          {agent.def.purpose}
        </p>
      </div>
      <p className="max-w-md text-[12.5px] leading-relaxed text-ink-600">
        <span className="font-medium text-ink-800">Today that costs:</span>{" "}
        {agent.def.incumbent}.
      </p>
      <div className="text-right">
        <div className="tnum text-[13px] font-medium text-ink-900">
          {formatNumber(agent.runs)} runs
        </div>
        <div className="mt-0.5 text-[11.5px] text-ink-500">
          {agent.def.measure.name.toLowerCase()}, target {agent.def.measure.target}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { TakeReading } from "@/components/take-reading";
import { getClock } from "@/lib/session";
import { getReadingWithExamples, getSnapshots } from "@/lib/queries/nps";
import {
  BASE_SCORE,
  OOP_BANDS,
  RUBRIC,
  RUBRIC_BY_ID,
  RUBRIC_VERSION,
  SURVEY_BASE_RATE,
  SURVEY_EXTREME_RATE,
  TEMPERAMENT_RANGE,
  type RubricGroup,
} from "@/lib/nps/rubric";
import { getRecommendations } from "@/lib/nps/recommendations";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const GROUP_ORDER: RubricGroup[] = [
  "Counter",
  "Authorisation",
  "Money",
  "Coverage",
  "Clinical",
  "Convenience",
];

export default async function ExperiencePage() {
  const clock = await getClock();
  // Load sequentially so the heavy claim scan does not compete with snapshot /
  // recommendation queries for the small Prisma pool behind PgBouncer.
  const { reading, examples, quotes } = await getReadingWithExamples(clock);
  const snapshots = await getSnapshots();
  const recommendations = await getRecommendations(clock);

  const c = reading.census;
  const s = reading.surveyed;
  const gap = Math.round((s.nps - c.nps) * 10) / 10;
  const responseRate = c.scored > 0 ? (s.scored / c.scored) * 100 : 0;
  const peak = Math.max(1, ...reading.histogram);

  const negatives = reading.drivers.filter((d) => d.totalPoints < 0);
  const positives = reading.drivers.filter((d) => d.totalPoints > 0);
  const worstShare =
    negatives.length > 0
      ? Math.abs(negatives[0].totalPoints) /
        negatives.reduce((sum, d) => sum + Math.abs(d.totalPoints), 0)
      : 0;

  return (
    <div className="space-y-6">
      <SectionTitle
        description={`Modeled experience for ${formatNumber(c.scored)} members. Estimates, not survey responses.`}
        action={
          <Link
            href="/methodology"
            className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            Methodology
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        Member experience
      </SectionTitle>

      {/* ------------------------------------------------------------------ */}
      {/* What this is, before any number is read                            */}
      {/* ------------------------------------------------------------------ */}

      <Card className="border-amber-600/25 bg-amber-50/40">
        <div className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-amber-950">
          <p>
            <strong className="font-semibold">
              This is a model, not a measurement.
            </strong>{" "}
            No human being was asked anything. The book is synthetic, so there
            is no one to ask. What the book does contain is a complete record of
            what happened to each member — every fill turned away at a counter
            and the reason given, every authorisation denied, every dollar paid,
            every time money was taken back after the fact — and the schedule
            below turns that record into an answer between zero and ten.
          </p>
          <p>
            The consequence worth stating before management reads this as a
            progress bar:{" "}
            <strong className="font-semibold">
              it moves when the benefit or the operation changes, not when the
              software gains a feature.
            </strong>{" "}
            Shipping a new dashboard leaves it exactly where it was, because it
            leaves members exactly where they were. Raising a coinsurance rate
            or letting a termination file arrive three weeks late will move it,
            which is the entire point of having it.
          </p>
          <p>
            Everything below counts the year <strong>so far</strong>, to the
            simulation clock, like every other page here. It will drift down as
            the year runs, because a longer year is a longer list of chances to
            be turned away. The change console scores the{" "}
            <em>full</em> plan year instead, so that it matches the money it is
            printed beside; its numbers are lower for that reason and are not
            in conflict with these.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The two numbers                                                    */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Census"
            description="Everybody who used the benefit. No sampling, so nothing here is noise."
          />
          <div className="px-5 py-5">
            <div className="tnum text-[44px] font-semibold leading-none text-ink-900">
              {c.nps.toFixed(1)}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-600">
              across {formatNumber(c.scored)} members
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-ink-200/70 border-t border-ink-200/70">
            <Stat
              label="Promoters"
              value={`${((c.promoters / c.scored) * 100).toFixed(1)}%`}
              sub={`${formatNumber(c.promoters)} scoring 9-10`}
              tone="positive"
            />
            <Stat
              label="Passives"
              value={`${((c.passives / c.scored) * 100).toFixed(1)}%`}
              sub={`${formatNumber(c.passives)} scoring 7-8`}
            />
            <Stat
              label="Detractors"
              value={`${((c.detractors / c.scored) * 100).toFixed(1)}%`}
              sub={`${formatNumber(c.detractors)} scoring 0-6`}
              tone="negative"
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Modeled survey results"
            description="The same members, filtered by who would actually have replied to a questionnaire."
          />
          <div className="px-5 py-5">
            <div className="tnum text-[44px] font-semibold leading-none text-ink-900">
              {s.nps.toFixed(1)}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-600">
              from {formatNumber(s.scored)} responses, a{" "}
              {responseRate.toFixed(1)}% response rate
            </p>
          </div>
          <div className="border-t border-ink-200/70 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink-700">
              A questionnaire would have come back{" "}
              <strong className="font-semibold">
                {gap > 0 ? `${gap.toFixed(1)} points higher` : `${Math.abs(gap).toFixed(1)} points lower`}
              </strong>{" "}
              than the truth. Not because anybody lied, but because the people
              who spend four minutes on a survey about their pharmacy benefit
              are the furious and the delighted, and everyone in the middle
              deletes the email. Response is modelled at{" "}
              {(SURVEY_BASE_RATE * 100).toFixed(0)}% normally and{" "}
              {(SURVEY_EXTREME_RATE * 100).toFixed(0)}% for members at either
              end.
            </p>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Distribution                                                       */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="The distribution"
          description="A summary statistic can hide almost anything. This is the shape it came from."
        />
        <div className="space-y-1.5 px-5 py-5">
          {reading.histogram
            .map((n, score) => ({ n, score }))
            .reverse()
            .map(({ n, score }) => {
              const segment =
                score >= 9
                  ? "bg-emerald-500"
                  : score >= 7
                    ? "bg-ink-300"
                    : "bg-rose-400";
              return (
                <div key={score} className="flex items-center gap-3">
                  <span className="tnum w-5 shrink-0 text-right text-[12px] font-medium text-ink-600">
                    {score}
                  </span>
                  <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-ink-100">
                    <div
                      className={`h-full rounded-sm ${segment}`}
                      style={{ width: `${(n / peak) * 100}%` }}
                    />
                  </div>
                  <span className="tnum w-16 shrink-0 text-right text-[12px] text-ink-700">
                    {formatNumber(n)}
                  </span>
                  <span className="tnum hidden w-12 shrink-0 text-right text-[12px] text-ink-500 sm:block">
                    {((n / c.scored) * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
        </div>
        <div className="border-t border-ink-200/70 px-5 py-3.5">
          <p className="text-[13px] leading-relaxed text-ink-700">
            {formatNumber(reading.histogram[0] + reading.histogram[10])} members
            sit against the ends of the scale, which is{" "}
            {(
              ((reading.histogram[0] + reading.histogram[10]) / c.scored) *
              100
            ).toFixed(1)}
            % of the book. That matters because a schedule whose deductions
            outrun the scale stops being able to tell a bad year from a
            catastrophic one, and the distribution starts describing the
            arithmetic instead of the members. A further{" "}
            {formatNumber(reading.excluded)} members have not presented a
            prescription at all this year and are not scored: you cannot rate a
            benefit you have never used, and inventing answers for them would
            put tens of thousands of manufactured opinions into the total.
            Members who presented one and were turned away{" "}
            <em>are</em> scored, and score badly, which is the whole reason to
            draw the line at having tried rather than at having succeeded.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Drivers                                                            */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Score drivers"
          description="Total points each term took off, or put on, across the whole book. This is the part worth acting on: it says where the benefit hurts, not just how much."
        />
        <Table>
          <thead>
            <tr>
              <Th>What happened</Th>
              <Th align="right">Members</Th>
              <Th align="right">Points</Th>
            </tr>
          </thead>
          <tbody>
            {[...negatives, ...positives.reverse()].map((d) => {
              const term = RUBRIC_BY_ID[d.id];
              const negative = d.totalPoints < 0;
              return (
                <tr key={d.id}>
                  <Td>
                    <div className="flex items-start gap-2">
                      <Badge tone={negative ? "negative" : "positive"}>
                        {term?.group ?? "—"}
                      </Badge>
                      <span className="text-ink-800">
                        {term?.says ?? d.id}
                      </span>
                    </div>
                  </Td>
                  <Td align="right" className="tnum">
                    {formatNumber(d.membersAffected)}
                  </Td>
                  <Td align="right" className="tnum">
                    <span
                      className={
                        negative
                          ? "font-medium text-rose-700"
                          : "font-medium text-emerald-700"
                      }
                    >
                      {d.totalPoints > 0 ? "+" : ""}
                      {formatNumber(Math.round(d.totalPoints))}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="border-t border-ink-200/70 px-5 py-3.5">
          <p className="text-[13px] leading-relaxed text-ink-700">
            The heaviest single term accounts for {(worstShare * 100).toFixed(0)}
            % of everything deducted. That figure is worth watching: if one term
            ever ran away with the total, this would have stopped being a score
            about the benefit and become a restatement of that one term with
            extra steps.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Examples                                                           */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="At the bottom"
            description="The lowest scores in the book, and why."
          />
          <div className="divide-y divide-ink-200/70">
            {examples.detractors.map((m) => (
              <ExampleRow key={m.id} m={m} />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="At the top"
            description="Members who got everything they came for."
          />
          <div className="divide-y divide-ink-200/70">
            {examples.promoters.map((m) => (
              <ExampleRow key={m.id} m={m} />
            ))}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Feedback                                                           */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Modeled member feedback"
          description="The free-text box, rendered from the record. Only members the response model has replying are quoted, matching the surveyed figure rather than the census."
        />
        <div className="border-b border-ink-200/70 bg-amber-50/40 px-5 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-ink-700">
            <strong className="font-semibold">Nobody wrote these.</strong> Every
            clause below is triggered by a specific count of specific claims for
            that member, and the wording is picked from a fixed set by a hash of
            their id, so it never changes and carries no meaning of its own.
            They are the same facts the driver table prints as totals, set out
            one member at a time. The arithmetic sits under each one and the
            name links to the claims, so nothing here has to be taken on trust.
          </p>
        </div>
        <div className="divide-y divide-ink-200/70">
          {quotes.map((q) => (
            <div key={q.memberId} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "tnum mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                    q.segment === "detractor"
                      ? "bg-rose-100 text-rose-700"
                      : q.segment === "promoter"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-ink-100 text-ink-600",
                  )}
                >
                  {q.score}
                </div>
                <div className="min-w-0">
                  <p className="text-[13.5px] italic leading-relaxed text-ink-800">
                    &ldquo;{q.text}&rdquo;
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-500">
                    <Link
                      href={`/members/${q.memberId}`}
                      className="font-medium text-glass-700 hover:text-glass-800"
                    >
                      {q.name}
                    </Link>
                    <span className="text-ink-300">·</span>
                    <span className="capitalize">{q.segment}</span>
                    <span className="text-ink-300">·</span>
                    <span className="tnum">{q.reason}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Themes                                                             */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Modeled concerns"
          description="Members counted against the single worst thing that happened to them, which is what the top of a support queue looks like."
        />
        <div className="border-b border-ink-200/70 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">
            Deliberately not the same ranking as the drivers above. A term can
            build a large point total by mildly irritating a great many people,
            which is worth knowing and is not what anybody rings up about. This
            counts the members for whom a given thing was{" "}
            <em>the</em> problem with their year.
          </p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Their worst experience</Th>
              <Th>Where</Th>
              <Th align="right">Members</Th>
              <Th align="right">Of those, detractors</Th>
            </tr>
          </thead>
          <tbody>
            {reading.themes.slice(0, 9).map((t) => {
              const term = RUBRIC_BY_ID[t.id];
              const share = t.members > 0 ? (t.detractors / t.members) * 100 : 0;
              return (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium text-ink-900">
                      {term?.says ?? t.id}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone="neutral">{term?.group ?? "—"}</Badge>
                  </Td>
                  <Td align="right" className="tnum">
                    {formatNumber(t.members)}
                  </Td>
                  <Td align="right" className="tnum">
                    {formatNumber(t.detractors)}
                    <span className="ml-1.5 text-[11.5px] text-ink-400">
                      {share.toFixed(0)}%
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Recommendations                                                    */}
      {/* ------------------------------------------------------------------ */}

      <Card className="border-glass-500/25">
        <CardHeader
          title="Recommended actions"
          description="Each of these names the edit, the drug or tier behind it, and how many members it would stop hurting. Every figure is counted from the book."
        />
        <div className="border-b border-ink-200/70 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">
            The complaints concentrate far more than they look like they should.
            The sixteen thousand members turned away by a quantity limit did not
            run into thousands of different drugs, they ran into forty-five, and
            the worst single one accounts for nearly four thousand of them. That
            makes this a list rather than a strategy. Ranked by members affected
            rather than by expected score movement, because ranking a set of
            fixes by the metric they are judged on is how the metric stops being
            worth having.
          </p>
        </div>
        <div className="divide-y divide-ink-200/70">
          {recommendations.map((r) => (
            <div key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink-900">
                      {r.title}
                    </h3>
                    <Badge tone="neutral">
                      {RUBRIC_BY_ID[r.addresses]?.group ?? r.addresses}
                    </Badge>
                  </div>
                  <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-ink-600">
                    {r.rationale}
                  </p>
                  <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-ink-500">
                    <span className="font-medium text-ink-600">Caution.</span>{" "}
                    {r.caution}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <div className="tnum text-[16px] font-semibold text-ink-900">
                      {formatNumber(r.membersAffected)}
                    </div>
                    <div className="text-[11px] text-ink-500">members</div>
                  </div>
                  <div className="w-24 text-right">
                    <div className="tnum text-[16px] font-semibold text-ink-900">
                      {r.pointsAtStake === null
                        ? "—"
                        : formatNumber(Math.round(r.pointsAtStake))}
                    </div>
                    <div className="text-[11px] leading-tight text-ink-500">
                      {r.pointsAtStake === null
                        ? "needs the engine"
                        : "points at stake"}
                    </div>
                  </div>
                  <Link
                    href={r.href}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-ink-800"
                  >
                    Model it
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-ink-200/70 bg-ink-50/60 px-5 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            <strong className="font-semibold text-ink-800">
              Points at stake is an upper bound, not a forecast.
            </strong>{" "}
            It is what the schedule currently deducts for the rejects this edit
            would remove. The real movement is smaller: caps bite, temperament
            varies, and a fill that starts being paid brings cost share with it.
            Following a recommendation into the change console projects the
            actual figure against a sample of the book in a few seconds, and
            measures it against all of it in half a minute.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The schedule                                                       */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="The schedule, in full"
          description={`Version ${RUBRIC_VERSION}. Fixed in code and deliberately not adjustable from this page: a dial that changes the score is a dial that lets whoever holds it produce whichever score they wanted.`}
        />
        <div className="border-b border-ink-200/70 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-700">
            Everybody starts at{" "}
            <strong className="font-semibold">{BASE_SCORE} out of 10</strong>,
            because a benefit that did exactly what it promised and nothing more
            has earned a passive rather than a promoter. &ldquo;It worked&rdquo;
            is not a reason to recommend something; it is the absence of a
            reason to complain. Members become promoters by having something to
            point at, and detractors by having something taken from them. On top
            of the schedule sits a fixed temperament of up to ±
            {TEMPERAMENT_RANGE.toFixed(1)} points per member, derived from their
            id and nothing else, so two people who had the same year do not give
            the same answer — and so a copay change moves their score without
            moving their disposition.
          </p>
        </div>
        {GROUP_ORDER.map((group) => {
          const terms = RUBRIC.filter((t) => t.group === group);
          if (terms.length === 0) return null;
          return (
            <div key={group}>
              <div className="border-b border-ink-200/70 bg-ink-50/60 px-5 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">
                  {group}
                </span>
              </div>
              <Table>
                <thead className="sr-only">
                  <tr>
                    <Th>Term</Th>
                    <Th align="right">Points</Th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <div className="space-y-1">
                          <div className="text-[13px] text-ink-900">
                            &ldquo;{t.says}&rdquo;
                          </div>
                          <div className="text-[12px] leading-relaxed text-ink-500">
                            {t.method}
                          </div>
                        </div>
                      </Td>
                      <Td align="right" className="tnum">
                        <span
                          className={
                            t.points >= 0
                              ? "font-medium text-emerald-700"
                              : "font-medium text-rose-700"
                          }
                        >
                          {t.id === "oop-band"
                            ? "banded"
                            : `${t.points > 0 ? "+" : ""}${t.points}`}
                        </span>
                        {t.repeatPoints ? (
                          <div className="text-[11px] text-ink-500">
                            {t.repeatPoints} each after
                          </div>
                        ) : null}
                        {t.cap !== undefined && t.points < 0 ? (
                          <div className="text-[11px] text-ink-500">
                            capped at {t.cap}
                          </div>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          );
        })}
        <div className="border-t border-ink-200/70 bg-ink-50/60 px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-600">
            Out-of-pocket bands
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5">
            {OOP_BANDS.map((b) => (
              <span key={b.label} className="text-[12.5px] text-ink-700">
                {b.label}{" "}
                <span
                  className={`tnum font-medium ${
                    b.points === 0
                      ? "text-ink-500"
                      : b.points > 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                  }`}
                >
                  {b.points > 0 ? "+" : ""}
                  {b.points}
                </span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* History                                                            */}
      {/* ------------------------------------------------------------------ */}

      <Card>
        <CardHeader
          title="Readings over time"
          description="Taken by hand, or automatically whenever a benefit change is committed. The point of keeping them is to be able to say what a decision cost."
          action={<TakeReading />}
        />
        {snapshots.length === 0 ? (
          <EmptyState
            title="No readings yet"
            description="Take one to establish a baseline. Every reading after it can be compared against this book as it stands today."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reading</Th>
                <Th>Taken</Th>
                <Th align="right">Census</Th>
                <Th align="right">Change</Th>
                <Th align="right">Surveyed</Th>
                <Th align="right">Detractors</Th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => (
                <tr key={snap.id}>
                  <Td>
                    <div className="font-medium text-ink-900">{snap.label}</div>
                    {snap.configVersionLabel ? (
                      <div className="text-[12px] text-ink-500">
                        on committing {snap.configVersionLabel}
                      </div>
                    ) : null}
                    {snap.note ? (
                      <div className="text-[12px] text-ink-500">
                        {snap.note}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="text-ink-700">
                      {formatDate(snap.takenAt)}
                    </div>
                    <div className="text-[12px] text-ink-500">
                      schedule {snap.rubricVersion}
                    </div>
                  </Td>
                  <Td align="right" className="tnum">
                    {snap.npsCensus.toFixed(1)}
                  </Td>
                  <Td align="right" className="tnum">
                    {snap.delta === null ? (
                      <span className="text-[12px] text-ink-400">—</span>
                    ) : (
                      <span
                        className={
                          Math.abs(snap.delta) <= 0.1
                            ? "text-ink-500"
                            : snap.delta > 0
                              ? "font-medium text-emerald-700"
                              : "font-medium text-rose-700"
                        }
                      >
                        {snap.delta > 0 ? "+" : ""}
                        {snap.delta.toFixed(1)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="tnum">
                    {snap.npsSurveyed.toFixed(1)}
                  </Td>
                  <Td align="right" className="tnum">
                    {formatNumber(snap.detractors)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-ink-200/70 px-5 py-3.5">
          <p className="text-[13px] leading-relaxed text-ink-700">
            A change of schedule version between two rows means the question
            changed, and the difference between them is left blank rather than
            printed. Subtracting across a redefinition produces a number that
            looks like the benefit moved when what actually moved was the way it
            is being measured, and that is how a metric quietly becomes
            worthless.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Model limits" />
        <div className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-ink-700">
          <p>
            It is not sentiment. It is an argument about experience, built from
            records, and its weights are somebody&rsquo;s judgement about how
            much a denied authorisation stings relative to a four-hundred-dollar
            fill. Reasonable people would set them differently. They are printed
            above so that a disagreement can be about a specific weight instead
            of about the total.
          </p>
          <p>
            It cannot see anything the book does not record. A member who waited
            forty minutes at a counter, or could not get through on the
            telephone, or was spoken to rudely, scores here exactly as if none
            of that happened. Those are real reasons people rate a benefit
            poorly and this model is blind to all of them, which is one more
            reason it is a floor on dissatisfaction rather than a measurement of
            it.
          </p>
        </div>
      </Card>
    </div>
  );
}

function ExampleRow({
  m,
}: {
  m: { id: string; name: string; score: number; reasons: string[] };
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span
        className={`tnum mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[14px] font-semibold ${
          m.score >= 9
            ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20"
            : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-600/20"
        }`}
      >
        {m.score}
      </span>
      <div className="min-w-0">
        <Link
          href={`/members/${m.id}`}
          className="text-[13px] font-medium text-glass-700 hover:text-glass-900"
        >
          {m.name}
        </Link>
        <ul className="mt-0.5 space-y-0.5">
          {m.reasons.map((r) => (
            <li key={r} className="text-[12.5px] leading-relaxed text-ink-600">
              &ldquo;{r}&rdquo;
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

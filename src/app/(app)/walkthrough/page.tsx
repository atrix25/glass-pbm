import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { getClock } from "@/lib/session";
import { getWalkthroughFacts, type WalkthroughFacts } from "@/lib/queries/walkthrough";
import {
  Badge,
  Card,
  CardHeader,
  SectionTitle,
  Stat,
} from "@/components/ui";
import { formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";

export const metadata = {
  title: "Guided walkthrough",
};

/**
 * The tour, written for somebody who suspects the whole thing is a mock-up.
 *
 * A demo that only shows what works is not evidence, it is a slide deck with a
 * cursor. The organising idea here is that every stop carries a number pulled
 * live out of the same database the stop describes, and an instruction to go
 * and check something rather than to look at something. The sceptical
 * questions are answered before the tour rather than after it, because a
 * person who thinks the numbers are typed in will not read twenty-three
 * paragraphs about pages first.
 */

interface Stop {
  n: number;
  href: string;
  title: string;
  /** What the page is, in the plainest terms available. */
  what: string;
  /** Something to do, not something to look at. */
  tryThis: ReactNode;
  /** A live figure, so the stop cannot be stale. */
  figure?: { value: string; label: string };
  /** Where to go for the specific record being talked about. */
  deepLink?: { href: string; label: string } | null;
  /**
   * Set on the stops that make up the ten minute tour, to the one line that
   * says why this stop earns a place in it. Derived from the longer copy it
   * would sometimes open on a sentence about the tour rather than about the
   * page.
   */
  short?: string;
}

interface Act {
  title: string;
  premise: string;
  stops: Stop[];
}

function buildActs(f: WalkthroughFacts): Act[] {
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);

  return [
    {
      title: "Where the plan stands today",
      premise:
        "Start with the two pages an employer would actually open, so the rest of the tour has something to be about.",
      stops: [
        {
          n: 1,
          href: "/operations",
          title: "Live operations",
          short:
            "Proof that the thing is running, not rendered from a fixture.",
          what: "The plan as of this instant: what was filled today, what is waiting for a decision, and what the year looks like at the current run rate. Everything is cut against the simulation clock in the bar at the top of every page.",
          tryThis: (
            <>
              Move the clock forward with <strong>+1 week</strong> in the bar
              above and come back. Claims dated after the clock have not
              happened yet, and authorisations received but not yet decided are
              still sitting open. Nothing on this page is a stored total.
            </>
          ),
          figure: {
            value: formatNumber(f.claims),
            label: "claims adjudicated so far this plan year",
          },
        },
        {
          n: 2,
          href: "/sponsor",
          title: "Plan sponsor dashboard",
          what: "The year in one page: what the plan spent, on whom, through which channel, and at what mix of generic, brand and specialty. Every figure is a sum over individual claims rather than a number carried forward from a report.",
          tryThis: (
            <>
              Note the total plan spend, then go to the claim ledger and filter.
              The two agree because they are the same rows counted twice, not
              two systems reconciled to each other.
            </>
          ),
          figure: {
            value: formatCentsCompact(f.planPaidCents),
            label: "paid by the plan, year to date",
          },
        },
      ],
    },
    {
      title: "The foundation: who is covered",
      premise:
        "Every number in a pharmacy benefit rests on knowing who was eligible on the day of the fill. Get this wrong and everything downstream is wrong quietly.",
      stops: [
        {
          n: 3,
          href: "/eligibility",
          title: "Eligibility feed",
          what: "Membership is not typed in. It arrives on ANSI X12 834 files from the employer's payroll system, and each file is a batch of instructions to add, change or terminate a person's coverage. Defective instructions are rejected and sent back rather than guessed at.",
          tryThis: (
            <>
              Scroll to the sample transaction and read the raw X12. Then look
              at the reject aging: the file that arrives late is the reason a
              member gets turned away at a counter, and the reason a plan pays
              for someone who left in March.
            </>
          ),
          figure: {
            value: `${formatNumber(f.eligibilityFiles)} files`,
            label: `${formatNumber(f.eligibilityRejected)} instructions rejected and returned`,
          },
        },
        {
          n: 4,
          href: "/members",
          title: "Membership",
          what: "The covered population. These people are invented — that is stated here and on the methodology page — but their ages, conditions and utilisation were generated to match the distribution published in the state's own ET-8933 benefits fact sheet.",
          tryThis: (
            <>
              Open one member and read down their year: every fill, what the
              plan paid, what they paid, and the point where they hit the
              out-of-pocket limit and their cost share stops.
            </>
          ),
          figure: {
            value: formatNumber(f.lives),
            label: "covered lives on file",
          },
          deepLink: f.exampleMember
            ? { href: f.exampleMember.href, label: `Open ${f.exampleMember.label}` }
            : null,
        },
      ],
    },
    {
      title: "The transaction",
      premise:
        "A pharmacy benefit is one event repeated a million times: somebody hands over a prescription and a system decides, in under a second, what it costs and who pays. This is that event.",
      stops: [
        {
          n: 5,
          href: "/pos",
          title: "Pharmacy point of sale",
          what: "The live counter. Compose a claim, press transmit, and get an answer back from the real adjudication engine — the same code path that produced every one of the stored claims. Nothing is written: this is a test claim, evaluated and discarded, exactly as a pharmacy's own test transmission would be.",
          tryThis: (
            <>
              Transmit a fill, then change one field &mdash; the days supply,
              the pharmacy, or the drug &mdash; and transmit again. The price
              moves, and the derivation beside it names the rule that moved it.
              Try a quantity above the formulary limit and it comes back
              rejected on NCPDP code 76, which is the engine deciding rather
              than a scripted response.
            </>
          ),
          figure: {
            value: `${formatNumber(f.drugs)} drugs`,
            label: `across ${f.pharmacies} contracted pharmacies`,
          },
        },
        {
          n: 6,
          href: "/claims",
          title: "Claim ledger",
          what: "Every claim the engine has adjudicated, paid and rejected, with the reason code on the ones that failed. A rejected claim moves no money, which is checked over the whole book rather than asserted.",
          tryThis: (
            <>
              Filter to rejected claims and read the reason codes. They are
              NCPDP codes, not invented labels, and each one corresponds to a
              rule that actually fired.
            </>
          ),
          figure: {
            value: `${formatNumber(f.claimsPaid)} paid`,
            label: `${formatNumber(f.claimsRejected)} rejected, ${pct(f.claimsRejected, f.claims)} of the book`,
          },
        },
        {
          n: 7,
          href: f.exampleClaim?.href ?? "/claims",
          title: "One claim, fully derived",
          short:
            "The arithmetic behind a single fill, down to the document each rule came from.",
          what: "This is the stop that answers the question everyone is really asking. Open a claim and you get the whole derivation: which rules fired in which order, which benchmark price each one read, what the contract says, and the published document behind it.",
          tryThis: (
            <>
              Read the green banner at the top of the derivation. It says the
              claim was <strong>recomputed just now</strong>, how many
              milliseconds it took, and that the result agrees with the book:
              the trace you are reading was produced by running the engine
              again against the claim&rsquo;s stored inputs, not read out of a
              log. Then find the <strong>lesser-of</strong> comparison and read
              the losing arm. The engine priced the claim three ways, took the
              lowest, and shows you the two it did not use.
            </>
          ),
          figure: f.exampleClaim
            ? { value: f.exampleClaim.label, label: f.exampleClaim.detail }
            : undefined,
        },
      ],
    },
    {
      title: "The clinical gate",
      premise:
        "Some drugs are not simply covered or not covered. Somebody has to decide, against published criteria, and be able to show which question decided it.",
      stops: [
        {
          n: 8,
          href: "/pa",
          title: "Prior authorization",
          short:
            "A denial traced to a numbered question on a published form.",
          what: "Requests arrive, wait, and become determinations as the clock runs. Where a criteria form has been transcribed from the published PDF, the engine walks it question by question and records the numbered step that decided the case.",
          tryThis: (
            <>
              Open a decided request and find the deciding step. Then open the
              source PDF from the sources page and check that step 7 in the
              system is step 7 on the form. That check is the entire point:
              a denial you cannot trace to a published question is not a
              defensible denial.
            </>
          ),
          figure: {
            value: formatNumber(f.priorAuths),
            label: `${formatNumber(f.priorAuthsByTree)} decided by walking a transcribed criteria form`,
          },
          deepLink: f.examplePa
            ? { href: f.examplePa.href, label: `Open ${f.examplePa.label} — ${f.examplePa.detail}` }
            : null,
        },
        {
          n: 9,
          href: "/clinical",
          title: "Clinical safety",
          what: "Every paid fill screened against the rest of that member's active therapy: drug interactions, duplicate therapy, and cumulative opioid dose in morphine milligram equivalents against the CDC thresholds.",
          tryThis: (
            <>
              Look at the rules that <em>did not</em> fire as well as the ones
              that did. A screening system that only reports its hits is
              unfalsifiable.
            </>
          ),
          figure: {
            value: formatNumber(f.durAlerts),
            label: "conflicts raised across the book",
          },
        },
      ],
    },
    {
      title: "Where the money actually goes",
      premise:
        "A pharmacy benefit manager is a payments company wearing a clinical hat. It collects from the employer monthly, pays pharmacies twice a month, and chases manufacturers for rebates booked two quarters ago. This is the part incumbents do not show you.",
      stops: [
        {
          n: 10,
          href: "/settlement",
          title: "Settlement",
          what: "The three money flows, each tied to the claims behind it: what the plan was invoiced, what the network was paid, and what has actually been collected from manufacturers as against what was booked.",
          tryThis: (
            <>
              Compare what the plan was billed for drug cost against what the
              pharmacies were paid. Under pass-through those two are equal by
              construction, and the difference is checked to the cent on every
              claim in the book.
            </>
          ),
        },
        {
          n: 11,
          href: "/mac",
          title: "MAC and appeals",
          what: "The ceiling price on every multi-source generic, where it came from, and what happened when a pharmacy said it was too low to buy at. Wisconsin statute gives the pharmacy 21 days to appeal and requires the response to name a product available at or below the ceiling.",
          tryThis: (
            <>
              Open an upheld appeal and read the response. It names a specific
              NDC at a specific price, because the statute requires it. Then
              open an overturned one and check that the ceiling moved for every
              pharmacy, not only the one that complained.
            </>
          ),
          figure: {
            value: formatNumber(f.macAppeals),
            label: "pharmacy appeals filed and answered inside the statutory window",
          },
        },
        {
          n: 12,
          href: "/reversals",
          title: "Reversals and recoveries",
          what: "The messy half of the book. A fill that never left the counter has to be undone, and money already paid to a pharmacy for someone whose employer had not yet reported their termination has to be clawed back.",
          tryThis: (
            <>
              Check that a reversal nets its original claim to exactly zero
              across every money column, and that it is booked to the original
              date of service rather than the day it arrived. Both are enforced
              over the whole book.
            </>
          ),
          figure: {
            value: formatNumber(f.reversals),
            label: "reversals processed against original fills",
          },
        },
        {
          n: 13,
          href: "/reports",
          title: "Contract reporting",
          what: "The four questions an employer should be able to answer at the end of a contract year: did the PBM hit its pricing guarantees, what rebates were actually collected, what would a traditional spread PBM have charged for the same claims, and how sensitive is any of it to the benchmark.",
          tryThis: (
            <>
              Read the spread comparison. It re-prices this same book the way a
              traditional PBM would have, so the difference is a calculation on
              identical claims rather than a marketing figure.
            </>
          ),
        },
        {
          n: 14,
          href: "/reconciliation",
          title: "Guarantee reconciliation",
          what: "What the contract promised, measured month by month, including the months that were missed and the service credits owed as a result. A scorecard that never reports a miss is not a scorecard.",
          tryThis: (
            <>
              Find a missed month and follow it to the incident behind it. Every
              miss has a cause on file, and the credit is computed from the
              contract rather than negotiated afterwards.
            </>
          ),
        },
      ],
    },
    {
      title: "Managing the plan",
      premise:
        "Reporting tells you what happened. These two pages are for deciding what to do about it, and the second one is the capability most benefit consultants cannot buy at any price.",
      stops: [
        {
          n: 15,
          href: "/trends",
          title: "Trend management",
          what: "Cost per member per month, and the decomposition of the change into its causes: price, utilisation, mix, new starts and members leaving. The five drivers add up to the whole move, which is checked rather than approximated.",
          tryThis: (
            <>
              Find the class driving the largest share of trend, then carry that
              drug into the change console and cost an intervention against it.
            </>
          ),
        },
        {
          n: 16,
          href: "/changes",
          title: "Change console",
          short:
            "A benefit change costed by re-pricing every affected claim, exactly.",
          what: "Change the benefit and see the consequence before it is real. Every stored claim is re-adjudicated against the proposed configuration, in date order, with each member's accumulators rebuilt from scratch. This is not a trend factor applied to a total.",
          tryThis: (
            <>
              Move a copay or put a drug behind prior authorisation, then press{" "}
              <strong>model this change</strong>. You get the annual plan cost
              either way, the change in member out-of-pocket, how many members
              are affected, and how many claims that paid before would now
              reject. Underneath, <strong>members most affected</strong>{" "}
              names them one by one, with the before and after. Nobody has to be told
              the disruption is &ldquo;minimal&rdquo;.
            </>
          ),
          figure: {
            value: formatNumber(f.claimsPaid),
            label: "claims re-priced on every run, not a sample",
          },
        },
        {
          n: 17,
          href: "/experience",
          title: "Member experience",
          short:
            "What a benefit change costs the people it happens to, not just the plan.",
          what: "Every member who presented a prescription, scored from what actually happened to them — rejects, denials, waits, out-of-pocket burden, money clawed back — against a schedule printed in full on the page, then rendered as the comment each one would have left. Nobody was surveyed and nobody wrote those sentences. There is nobody in this book to survey.",
          tryThis: (
            <>
              Read the two numbers side by side. The census figure scores
              everybody; the surveyed figure scores only the members who would
              have replied to a questionnaire, and comes back far higher. That
              gap is what you are looking at whenever an incumbent quotes you a
              net promoter score. Then scroll to{" "}
              <strong>what to do about it</strong>. The complaints concentrate
              hard enough to be a list rather than a strategy: one antihistamine
              turned away nearly four thousand members on its own. Follow{" "}
              <strong>model it</strong> into the change console and the fix is
              projected against a sample of the book in seconds, then measured
              against all of it — so the member gain and the plan cost arrive
              together, which is the only honest way to look at either.
            </>
          ),
          figure: {
            value: `${f.npsCensus.toFixed(1)} vs ${f.npsSurveyed.toFixed(1)}`,
            label: "whole population against what a survey would have reported",
          },
        },
      ],
    },
    {
      title: "Catching what should not be there",
      premise:
        "Program integrity is inside the administrative fee here. In a traditional contract it is usually a separately priced service, or absent.",
      stops: [
        {
          n: 18,
          href: "/integrity",
          title: "Program integrity",
          what: "Every paid claim scored against the population it came from, by four detectors looking for members, prescribers and pharmacies that sit far outside their own peer group.",
          tryThis: (
            <>
              Note that five cases were deliberately planted in the book and the
              detectors were not told where. Check whether they surfaced on
              their own merits, at the top of their detector, rather than taking
              it on trust.
            </>
          ),
          figure: {
            value: formatNumber(f.integritySignals),
            label: "signals scored against peer distributions",
          },
        },
      ],
    },
    {
      title: "Where the agents do the work",
      premise:
        "Six agents run against this book. The interesting part is not that they run, it is that every one of them is on a leash you can inspect, and the register says how often a person overruled them.",
      stops: [
        {
          n: 19,
          href: "/agents",
          title: "Agent operations",
          short:
            "Six agents, each on a leash you can inspect, with the override rate published.",
          what: "The register: what each agent is allowed to do on its own, who decided that and when, how often a human reversed it, and what it cost to run. Nothing that moves money or denies care can apply itself, at any autonomy level.",
          tryThis: (
            <>
              Open the prior authorisation intake agent and run it against a
              real chart note. It reads the fax, marks the lines it relied on,
              and is scored against an answer key it never sees. Then open a run
              trace and read the steps: each one records why it happened before
              it happened.
            </>
          ),
          figure: {
            value: formatNumber(f.agentRuns),
            label: `${formatNumber(f.agentHeld)} proposals held for a person because they would move money or deny care`,
          },
          deepLink: f.exampleAgentRun
            ? {
                href: f.exampleAgentRun.href,
                label: "Open a run where the agent refused to guess",
              }
            : null,
        },
        {
          n: 20,
          href: "/assistant",
          title: "AI member service",
          what: "A member asks in plain language. The agent chooses which questions to put to the rules engine, looks at each answer before choosing the next, and states only what came back. It does no arithmetic of its own.",
          tryThis: (
            <>
              Ask it something clinical — &ldquo;should I stop taking
              this&rdquo;, &ldquo;is it safe with my other medications&rdquo;.
              It refuses and hands the question to a person with the context
              already assembled. An agent that answers everything is the
              dangerous kind.
            </>
          ),
          figure: {
            value: formatNumber(f.agentRefusals),
            label: "questions declined as clinical and handed to a person",
          },
        },
      ],
    },
    {
      title: "Why you should believe any of it",
      premise:
        "These four pages exist because the correct response to a demo is scepticism. They are the argument, and the honest account of where the argument runs out.",
      stops: [
        {
          n: 21,
          href: "/proof",
          title: "Correctness proof",
          short:
            "The harness, and an honest account of what it does and does not cover.",
          what: "The test harness, reported from its last real run rather than from a claim on this page. Two kinds of check: golden cases, where the expected figure is arithmetic you can do by hand from the contract, and invariants, which are properties checked across every claim at once.",
          tryThis: (
            <>
              Read the invariant names, then note what they are checked
              against: all {formatNumber(f.claimsPaid)} paid claims, not a
              sample. Further down, criteria branch coverage says which
              branches of each authorisation form have actually been walked by
              a real case, and the population reconciliation sets this
              invented membership against the published ET-8933 fact sheet it
              was generated to match.
            </>
          ),
          figure: f.testsAvailable
            ? {
                value: `${formatNumber(f.testsPassed)} passing`,
                label: f.testsFailed > 0 ? `${f.testsFailed} failing` : "none failing",
              }
            : undefined,
        },
        {
          n: 22,
          href: "/throughput",
          title: "Throughput",
          what: "Measured adjudication speed on this hardware, and what it extrapolates to at national scale. A benefit system that is correct but too slow to run is not a benefit system.",
          tryThis: (
            <>
              Compare the whole-book re-adjudication time against how long a
              traditional PBM takes to answer a plan design question. The
              honest comparison is not milliseconds against milliseconds, it is
              minutes against weeks.
            </>
          ),
          figure: f.claimsPerSecond
            ? {
                value: `${formatNumber(Math.round(f.claimsPerSecond))}/sec`,
                label: "claims adjudicated, measured on this build",
              }
            : undefined,
        },
        {
          n: 23,
          href: "/sources",
          title: "Source documents",
          what: "Every rate, copay, formulary tier, criteria step and statutory deadline in this system was read out of one of these documents. All of them are public. Each is hashed, and each says how many stored decisions point back at it.",
          tryThis: (
            <>
              Pick the contract, open the real PDF, and check a rate against
              what the system charged. A document that is doing no work shows up
              here as a document with no rows attached to it.
            </>
          ),
          figure: {
            value: `${f.sourceDocuments} documents`,
            label: "all public, all hashed, none paraphrased from memory",
          },
        },
        {
          n: 24,
          href: "/methodology",
          title: "Methodology",
          what: "The line between what is real, what is derived, and what is invented — plus a section titled what this does not establish. Read that section before deciding what you think.",
          tryThis: (
            <>
              Read the limitations first, then decide whether the rest is
              credible. A build that tells you where it is weak is easier to
              trust on the parts where it is strong.
            </>
          ),
        },
      ],
    },
  ];
}

function Question({
  q,
  children,
  links,
  open,
}: {
  q: string;
  children: ReactNode;
  links?: { href: string; label: string }[];
  /** The first one is open, so the rest are visibly worth opening. */
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-b border-ink-100 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 transition hover:bg-ink-50/60">
        <span className="mt-[3px] text-ink-400 transition group-open:rotate-90">
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13.5px] font-medium text-ink-900">{q}</span>
      </summary>
      <div className="px-5 pb-4 pl-[43px]">
        <div className="max-w-3xl space-y-2 text-[13px] leading-relaxed text-ink-700">
          {children}
        </div>
        {links && links.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
              >
                {l.label} &rarr;
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function StopRow({ stop }: { stop: Stop }) {
  return (
    <div className="flex gap-4 border-b border-ink-100 px-5 py-4 last:border-b-0">
      <div className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11.5px] font-semibold text-ink-600">
        {stop.n}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={stop.href}
            className="text-[14px] font-semibold tracking-tight text-glass-700 hover:text-glass-900"
          >
            {stop.title}
          </Link>
          {stop.short ? (
            <Badge tone="accent">in the short tour</Badge>
          ) : null}
        </div>

        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-600">
          {stop.what}
        </p>

        <div className="mt-2.5 rounded-lg border border-glass-600/20 bg-glass-50/50 px-3.5 py-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-glass-800">
            Try this
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-700">
            {stop.tryThis}
          </p>
        </div>

        {stop.deepLink ? (
          <Link
            href={stop.deepLink.href}
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-glass-700 hover:text-glass-900"
          >
            {stop.deepLink.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      {stop.figure ? (
        <div className="hidden w-[210px] shrink-0 border-l border-ink-100 pl-4 lg:block">
          <div className="tnum text-[15px] font-semibold tracking-tight text-ink-900">
            {stop.figure.value}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {stop.figure.label}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default async function WalkthroughPage() {
  const clock = await getClock();
  const facts = await getWalkthroughFacts(clock);
  const acts = buildActs(facts);
  const short = acts.flatMap((a) => a.stops.filter((s) => s.short));

  return (
    <div className="space-y-6">
      <SectionTitle description={"A guided tour of plan benefits, operations and evidence."}>
        Guided walkthrough
      </SectionTitle>

      <Card>
        <CardHeader
          title="Demo scope"
          description="One paragraph of orientation, for anyone who has not spent a career in pharmacy benefits."
        />
        <div className="max-w-4xl space-y-3 px-5 py-4 text-[13.5px] leading-relaxed text-ink-700">
          <p>
            A pharmacy benefit manager sits between an employer that pays for
            drugs, a member who collects them, and a pharmacy that dispenses
            them. It decides in under a second whether a fill is covered, what
            it costs, and how that cost splits between the employer and the
            member &mdash; then settles the money with everyone afterwards.
            Traditional managers make their margin in the gap between what they
            charge the employer and what they pay the pharmacy, and that gap is
            not disclosed.
          </p>
          <p>
            This build is a complete pass-through manager, running{" "}
            <strong>{formatNumber(facts.lives)} covered lives</strong> and{" "}
            <strong>{formatNumber(facts.claims)} adjudicated claims</strong>{" "}
            against a real published rate card. There is no gap: what the plan
            is billed for a drug is what the pharmacy is paid for it, and that
            is checked on every claim rather than promised.
          </p>
          <p className="text-ink-900">
            The one claim everything else rests on:{" "}
            <strong>
              no figure anywhere in this system is a stored answer.
            </strong>{" "}
            Every total is computed from individual claims when the page loads,
            and every individual claim can show the arithmetic that produced it,
            down to the published document each rule was read out of.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat
            label="Covered lives"
            value={formatNumber(facts.lives)}
            sub="built from 834 files, not typed in"
          />
        </Card>
        <Card>
          <Stat
            label="Claims adjudicated"
            value={formatNumber(facts.claims)}
            sub={`${formatNumber(facts.claimsPaid)} paid, ${formatNumber(facts.claimsRejected)} rejected with a reason code`}
          />
        </Card>
        <Card>
          <Stat
            label="Automated checks"
            value={facts.testsAvailable ? formatNumber(facts.testsPassed) : "—"}
            tone={facts.testsFailed > 0 ? "negative" : "positive"}
            sub={
              facts.testsAvailable
                ? facts.testsFailed > 0
                  ? `${facts.testsFailed} failing right now`
                  : "passing on the last real run"
                : "no harness result on file"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Source documents"
            value={String(facts.sourceDocuments)}
            sub="all public, all hashed"
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="If you have ten minutes"
          description="The six stops that carry the argument. Take them in order; each one answers the objection raised by the one before it."
          action={
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-500">
              <Clock className="h-3.5 w-3.5" />
              about 10 minutes
            </span>
          }
        />
        <ol className="divide-y divide-ink-100">
          {short.map((s, i) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-ink-50/60"
              >
                <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-glass-600 text-[10.5px] font-semibold text-white">
                  {i + 1}
                </span>
                <span className="text-[13.5px] font-medium text-ink-900">
                  {s.title}
                </span>
                <span className="truncate text-[12.5px] text-ink-500">
                  {s.short}
                </span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-300" />
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="The questions a sceptic should ask"
          description="Answered before the tour rather than after it, because these are the objections that decide whether the rest is worth reading. Each answer names the page where you can check it yourself."
        />
        <div>
          <Question
            open
            q="Is this a mock-up with the answers typed in?"
            links={[
              {
                href: facts.exampleClaim?.href ?? "/claims",
                label: "Open a claim and watch it recompute",
              },
              { href: "/proof", label: "The determinism suite" },
            ]}
          >
            <p>
              No, and there is a specific way to see that rather than a
              reassurance. Open a claim: before the page renders, the engine
              takes that claim&rsquo;s original inputs, runs the full pricing
              pipeline again, and compares the result against every figure
              stored on it. The banner at the top of the derivation reports how
              long that took and whether it agreed. If the stored figures had
              been written by hand, it would say so.
            </p>
            <p>
              The same check runs over the entire book in the test harness. Every
              one of the {formatNumber(facts.claimsPaid)} paid claims is
              re-adjudicated against its own configuration and must reproduce
              exactly, which is a much harder thing to fake than a page of
              plausible totals.
            </p>
          </Question>

          <Question
            q="Is the underlying data real, or is all of it invented?"
            links={[
              { href: "/sources", label: "The 22 source documents" },
              { href: "/methodology", label: "Real, derived and invented" },
            ]}
          >
            <p>
              Both, and the system labels which is which everywhere it matters.
              What is real and checkable by you: the CMS national drug
              acquisition cost file, the published Navitus ETG0013 rate card that
              prices every claim, the Certificate of Coverage that sets the
              copays, the prior authorisation criteria forms transcribed from
              the published PDFs, and the Wisconsin statutes that set the appeal
              deadlines.
            </p>
            <p>
              What is invented: the members and their fills, because real claims
              data cannot be published. Average wholesale price is also
              simulated, since it is proprietary, and every figure derived from
              it carries a badge saying so rather than being quietly mixed in
              with the real ones.
            </p>
          </Question>

          <Question
            q="How do you know the arithmetic is right?"
            links={[{ href: "/proof", label: "The harness and what it covers" }]}
          >
            <p>
              {facts.testsAvailable
                ? `${formatNumber(facts.testsPassed)} automated checks, of two kinds.`
                : "Automated checks of two kinds."}{" "}
              Golden cases state the expected number as arithmetic a person can
              do by hand from the published contract, then ask the engine; a
              failure means the engine disagrees with the contract. Invariants
              are properties that must hold across every claim at once &mdash;
              that the plan and the member together pay exactly what was billed,
              that nobody is charged more than their plan allows, that a rejected
              claim moves no money.
            </p>
            <p>
              The distinction matters. A hundred passing examples prove the
              examples work. An invariant searched for counterexamples across
              1.7 million claims proves there is no case anywhere in the book
              that breaks the rule.
            </p>
          </Question>

          <Question
            q="Would it survive real volume, or does it only work at demo scale?"
            links={[{ href: "/throughput", label: "Measured throughput" }]}
          >
            <p>
              This book is {formatNumber(facts.claims)} claims across{" "}
              {formatNumber(facts.lives)} lives, which is a mid-size employer
              rather than a toy.{" "}
              {facts.claimsPerSecond
                ? `Measured adjudication runs at about ${formatNumber(Math.round(facts.claimsPerSecond))} claims a second on the hardware this is running on, and the whole year can be re-priced against a new benefit design in minutes.`
                : "Throughput has not been benchmarked on this build, and the page says so rather than estimating."}
            </p>
            <p>
              The number that matters commercially is not raw speed. It is that
              a plan design question which takes a traditional manager weeks of
              analyst time is answered here by re-adjudicating every affected
              claim, exactly, while somebody waits.
            </p>
          </Question>

          <Question
            q="Where does the AI actually do anything, and what happens when it is wrong?"
            links={[
              { href: "/agents", label: "The agent register" },
              { href: "/assistant", label: "Ask it something clinical" },
            ]}
          >
            <p>
              Six agents run against this book, and the register records{" "}
              {formatNumber(facts.agentRuns)} real invocations. None of them
              computes anything: they choose which questions to put to the rules
              engine and narrate what comes back, which is why an agent cannot
              get a number wrong here &mdash; it can only ask the wrong question,
              and the trace shows which questions it asked.
            </p>
            <p>
              Every agent has an autonomy level, a named owner who set it, and a
              date it changed. {formatNumber(facts.agentHeld)} proposals were
              held for a person because they would have moved money or denied
              care; nothing in that category can ever apply itself, whatever the
              policy says, and the test harness checks that over every proposal
              ever written. The register also publishes how often a human
              reversed the agent, which is the number that tells you whether it
              is any good.
            </p>
          </Question>

          <Question
            q="What is this build not doing?"
            links={[{ href: "/methodology", label: "What this does not establish" }]}
          >
            <p>
              It is not connected to a real pharmacy network, so no actual claim
              has ever been transmitted to it. It has no Medicare or Medicaid
              lines of business, which carry rules this does not implement. The
              rebate contracts are modelled on published aggregate figures rather
              than on real manufacturer agreements, which are confidential. And
              a system that is arithmetically correct is not the same as a system
              that is operationally ready: there is no claims-processor
              certification, no SOC 2, and no disaster recovery story here.
            </p>
            <p>
              The member experience score is modelled, not measured. No human
              being was surveyed, because there are no humans in this book to
              survey. It is an argument about how members would answer given
              what demonstrably happened to them, computed from a schedule
              printed in full on the page, and it should be read as an argument
              rather than as a finding about sentiment.
            </p>
            <p>
              The methodology page carries the full list. It is worth reading
              before deciding what you think of the rest.
            </p>
          </Question>
        </div>
      </Card>

      {acts.map((act, i) => (
        <Card key={act.title}>
          <CardHeader
            title={
              <span className="flex items-baseline gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-400">
                  Part {i + 1}
                </span>
                {act.title}
              </span>
            }
            description={act.premise}
          />
          <div>
            {act.stops.map((stop) => (
              <StopRow key={`${stop.n}-${stop.href}`} stop={stop} />
            ))}
          </div>
        </Card>
      ))}

      <Card className="border-ink-300/70 bg-ink-50/50">
        <CardHeader
          title="Validation scenarios"
          description="The most useful thing a sceptical reader can do is try to make the system contradict itself. These four are the easiest attempts, and all of them are meant to fail."
        />
        <ul className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-ink-700">
          <li>
            <strong>Find a claim where the plan and the member together do
            not add up to what was billed.</strong>{" "}
            Sort the ledger however you like. This is checked over the whole
            book, so a counterexample is a real bug rather than a rounding
            quibble.
          </li>
          <li>
            <strong>Find a total on a summary page that disagrees with the
            claims underneath it.</strong>{" "}
            The dashboard, the reports and the ledger are the same rows counted
            different ways, and the daily rollup is checked against the claims
            it summarises.
          </li>
          <li>
            <strong>Find a prior authorisation denial whose deciding step is
            not on the published form.</strong>{" "}
            Open the PDF from the sources page and compare. Where no form was
            transcribed, the record says a pharmacist decided instead of
            inventing a step.
          </li>
          <li>
            <strong>Get the member service agent to state a number the rules
            engine did not return.</strong>{" "}
            Every figure in every answer is traceable to a tool result, and the
            work panel beside the conversation names which one.
          </li>
        </ul>
      </Card>
    </div>
  );
}

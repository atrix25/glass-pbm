"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PitchExperience, PitchBookStats } from "@/lib/pitch/experiences";
import type { PitchSlide } from "@/lib/pitch/slides";
import { setActiveMember } from "@/app/actions/session";

function subscribeToSlide(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function slideSnapshot() { return window.location.hash; }
function serverSlideSnapshot() { return "#1"; }

export function PitchDeck({
  slides,
  experiences,
  stats,
}: {
  slides: PitchSlide[];
  experiences: Record<string, PitchExperience>;
  stats: PitchBookStats;
}) {
  const hash = useSyncExternalStore(subscribeToSlide, slideSnapshot, serverSlideSnapshot);
  const total = slides.length;
  const requested = Number.parseInt(hash.replace("#", ""), 10);
  const index = Number.isFinite(requested) ? Math.max(0, Math.min(total - 1, requested - 1)) : 0;
  const slide = slides[index]!;

  const go = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(total - 1, n));
      history.replaceState(null, "", `#${next + 1}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
    [total],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button, a, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(total - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, total]);

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 text-ink-900">
      <header className="flex items-center gap-3 border-b border-ink-200 px-4 py-3 sm:px-6">
        <Presentation className="h-4 w-4 text-glass-700" />
        <span className="text-[14px] font-semibold tracking-tight">Glass</span>
        <span className="hidden text-[12.5px] text-ink-500 sm:inline">
          Plan sponsor pitch
        </span>
        <span className="tnum ml-auto text-[12px] text-ink-500">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          disabled={index === 0}
          onClick={() => go(index - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12.5px] text-ink-700 transition hover:border-glass-400/50 hover:bg-white disabled:opacity-30"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <button
          type="button"
          disabled={index >= total - 1}
          onClick={() => go(index + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12.5px] text-ink-700 transition hover:border-glass-400/50 hover:bg-white disabled:opacity-30"
        >
          Next
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <Link
          href="/sponsor"
          className="hidden text-[12.5px] text-ink-500 transition hover:text-ink-900 sm:inline"
        >
          Exit
        </Link>
      </header>

      <div className="flex gap-1.5 overflow-x-auto border-b border-ink-200 px-4 py-2 sm:px-6">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            title={slideTitle(s, experiences)}
            aria-current={i === index}
            onClick={() => go(i)}
            className={cn(
              "h-1.5 w-6 shrink-0 rounded-full transition",
              i === index ? "bg-glass-400" : "bg-ink-200 hover:bg-ink-300",
            )}
          />
        ))}
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-12">
        {slide.kind === "title" && <TitleSlide slide={slide} stats={stats} />}
        {slide.kind === "problem" && <ProblemSlide slide={slide} />}
        {slide.kind === "pillars" && <PillarsSlide slide={slide} />}
        {slide.kind === "experience" && (
          <ExperienceSlide experience={experiences[slide.experienceId]!} />
        )}
        {slide.kind === "ask" && <AskSlide slide={slide} />}
      </main>

      <footer className="border-t border-ink-200 px-4 py-2 text-center text-[11px] text-ink-500 sm:px-6">
        Arrow keys or space to advance · Every experience below is a live path
        through the seeded book
      </footer>
    </div>
  );
}

function slideTitle(
  s: PitchSlide,
  experiences: Record<string, PitchExperience>,
): string {
  if (s.kind === "experience") {
    return experiences[s.experienceId]?.title ?? s.id;
  }
  return s.title;
}

function TitleSlide({
  slide,
  stats,
}: {
  slide: Extract<PitchSlide, { kind: "title" }>;
  stats: PitchBookStats;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-glass-700">
        {slide.eyebrow}
      </p>
      <h1 className="mt-3 max-w-[16ch] font-medium text-[40px] leading-[1.08] tracking-[-0.02em] sm:text-[52px]">
        {slide.title}
      </h1>
      <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink-500">
        {slide.lede}
      </p>
      <dl className="mt-10 grid max-w-3xl grid-cols-3 gap-px overflow-hidden rounded-xl border border-ink-200 bg-white">
        <Stat value={stats.lives} label="Simulated members" />
        <Stat value={stats.claims} label="Claims adjudicated" />
        <Stat value={stats.planPaid} label="Plan paid YTD" />
      </dl>
      <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-ink-500">
        The next slides are recorded experiences from this book — demo members,
        claims, prior auths, and reports you can open live.
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-500">
        {label}
      </dt>
      <dd className="tnum mt-1 text-[22px] font-semibold tracking-tight">
        {value}
      </dd>
    </div>
  );
}

function ProblemSlide({
  slide,
}: {
  slide: Extract<PitchSlide, { kind: "problem" }>;
}) {
  const cols = [
    {
      h: "Reporting today",
      items: [
        "Quarterly PDFs with stored totals",
        "Guarantee credits that never quite appear",
        "Finance and benefits see different numbers",
      ],
    },
    {
      h: "Transparency today",
      items: [
        "“Transparency” as a slide, not a ledger",
        "Pass-through sold, then exceptions",
        "No way to name every dollar either way",
      ],
    },
    {
      h: "Service today",
      items: [
        "Phone trees and callback queues",
        "Chatbots that cannot read the claim",
        "HR becomes the unofficial help desk",
      ],
    },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-glass-700">
        {slide.eyebrow}
      </p>
      <h1 className="mt-3 font-medium text-[36px] leading-tight tracking-[-0.02em] sm:text-[44px]">
        {slide.title}
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-500">
        {slide.lede}
      </p>
      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {cols.map((c) => (
          <div
            key={c.h}
            className="rounded-xl border border-ink-200 bg-white px-5 py-4"
          >
            <h3 className="text-[14px] font-semibold">{c.h}</h3>
            <ul className="mt-3 space-y-2">
              {c.items.map((item) => (
                <li
                  key={item}
                  className="text-[13px] leading-snug text-ink-500"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function PillarsSlide({
  slide,
}: {
  slide: Extract<PitchSlide, { kind: "pillars" }>;
}) {
  const pillars = [
    {
      n: "1",
      h: "Best-in-class reporting",
      p: "Totals from the claim ledger. Guarantees that settle alone. A data agent for ad-hoc briefings.",
    },
    {
      n: "2",
      h: "Transparency with flexible pricing",
      p: "Every dollar named. Pass-through, PEPM, shared savings, or disclosed margin — never an unexplained gap.",
    },
    {
      n: "3",
      h: "Service by chat and text",
      p: "Answers grounded in the same rules that priced the claim. Same book in chat, text, or handoff.",
    },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-glass-700">
        {slide.eyebrow}
      </p>
      <h1 className="mt-3 font-medium text-[36px] leading-tight tracking-[-0.02em] sm:text-[44px]">
        {slide.title}
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-500">
        {slide.lede}
      </p>
      <div className="mt-10 space-y-3">
        {pillars.map((p) => (
          <div
            key={p.n}
            className="flex gap-4 rounded-xl border border-ink-200 bg-white px-5 py-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-glass-600 text-white font-medium text-[18px]">
              {p.n}
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">{p.h}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">
                {p.p}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperienceSlide({ experience }: { experience: PitchExperience }) {
  const pillarLabel: Record<PitchExperience["pillar"], string> = {
    reporting: "Reporting",
    transparency: "Transparency",
    service: "Service",
    proof: "Proof",
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-glass-400/30 bg-glass-600/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-glass-700">
          {pillarLabel[experience.pillar]}
        </span>
        <span className="rounded-full border border-ink-200 px-2.5 py-0.5 text-[11px] text-ink-500">
          {experience.tag}
        </span>
        <span className="text-[11px] text-ink-500">Recorded experience</span>
      </div>

      <h1 className="mt-4 font-medium text-[34px] leading-tight tracking-[-0.02em] sm:text-[42px]">
        {experience.title}
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-500">
        {experience.story}
      </p>

      {experience.figure ? (
        <div className="mt-6 inline-flex max-w-md flex-col rounded-xl border border-ink-200 bg-white px-5 py-4">
          <span className="tnum font-medium text-[32px] tracking-tight">
            {experience.figure.value}
          </span>
          <span className="mt-1 text-[12.5px] text-ink-500">
            {experience.figure.label}
          </span>
        </div>
      ) : null}

      {experience.beats.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
            What happened in the book
          </h2>
          <ol className="mt-3 space-y-0 border-l border-ink-200 pl-4">
            {experience.beats.map((b, i) => (
              <li key={i} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-glass-400" />
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">
                  {b.when}
                </div>
                {b.href ? (
                  <Link
                    href={b.href}
                    className="mt-0.5 inline-flex items-start gap-1.5 text-[13.5px] leading-snug text-ink-700 transition hover:text-glass-700"
                  >
                    {b.what}
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Link>
                ) : (
                  <p className="mt-0.5 text-[13.5px] leading-snug text-ink-700">
                    {b.what}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-10">
        {experience.askPrompt && experience.memberName ? (
          <form action={setActiveMember}>
            <input type="hidden" name="memberId" value={experience.id} />
            <input
              type="hidden"
              name="next"
              value={`/assistant`}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-glass-600 px-4 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-glass-500"
            >
              Ask as {experience.memberName.split(" ")[0]}
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </form>
        ) : null}
        <Link
          href={experience.liveHref}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition",
            experience.askPrompt
              ? "border border-ink-200 text-ink-700 hover:border-glass-400/50 hover:bg-white"
              : "bg-glass-600 text-white hover:bg-glass-500",
          )}
        >
          {experience.liveLabel}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
        {experience.askPrompt ? (
          <p className="w-full text-[12.5px] text-ink-500 sm:w-auto">
            Suggested: “{experience.askPrompt}”
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AskSlide({ slide }: { slide: Extract<PitchSlide, { kind: "ask" }> }) {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-glass-700">
        {slide.eyebrow}
      </p>
      <h1 className="mt-3 font-medium text-[40px] leading-tight tracking-[-0.02em] sm:text-[48px]">
        {slide.title}
      </h1>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <h3 className="text-[14px] font-semibold">Near-term engagement</h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-snug text-ink-500">
            <li>Walk finance through recomputable contract reports</li>
            <li>Pick a fee model — keep full transparency</li>
            <li>Run live chat on real member questions</li>
            <li>Prototype SMS for rejects + PA status</li>
          </ul>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <h3 className="text-[14px] font-semibold">Next steps</h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-snug text-ink-500">
            <li>Reporting gaps finance cannot close</li>
            <li>Preferred fee construct for the next RFP</li>
            <li>Top member call / HR ticket reasons</li>
            <li>Whether SMS is allowed for benefits</li>
          </ul>
        </div>
      </div>
      <p className="mt-10 max-w-xl font-medium text-[26px] leading-snug tracking-[-0.02em] text-ink-700 sm:text-[30px]">
        Reports you can trust. Transparency that survives any fee model.
        Answers by chat and text.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/sponsor"
          className="inline-flex items-center gap-2 rounded-xl bg-glass-600 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-glass-500"
        >
          Enter the live book
          <ArrowUpRight className="h-4 w-4" />
        </Link>
        <Link
          href="/walkthrough"
          className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 py-2.5 text-[13.5px] font-semibold text-ink-700 hover:border-glass-400/50"
        >
          Full guided walkthrough
        </Link>
      </div>
    </div>
  );
}

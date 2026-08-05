"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Keyboard,
} from "lucide-react";
import type { PitchSlide } from "@/lib/pitch";
import { cn } from "@/lib/utils";

export function PitchDeck({ slides }: { slides: PitchSlide[] }) {
  const [index, setIndex] = useState(0);
  const [entered, setEntered] = useState(true);
  const slide = slides[index]!;
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, next));
      if (clamped === index) return;
      setEntered(false);
      window.setTimeout(() => {
        setIndex(clamped);
        setEntered(true);
      }, 120);
    },
    [index, slides.length],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(slides.length - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, slides.length]);

  return (
    <div
      className={cn(
        "relative flex min-h-dvh flex-col transition-colors duration-500",
        slide.tone === "dark"
          ? "bg-ink-950 text-white"
          : "bg-[radial-gradient(120%_80%_at_10%_-10%,#d3f5f3_0%,transparent_45%),radial-gradient(90%_70%_at_100%_0%,#eceef2_0%,transparent_40%),linear-gradient(180deg,#f8f9fb_0%,#eef2f6_100%)] text-ink-950",
      )}
    >
      {slide.tone === "dark" ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_15%_0%,rgba(56,190,193,0.22),transparent_55%),radial-gradient(60%_50%_at_90%_20%,rgba(20,129,135,0.18),transparent_50%),linear-gradient(180deg,#12161f_0%,#0d1218_100%)]"
        />
      ) : null}

      <header className="relative z-10 flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 transition hover:opacity-90"
        >
          <GlassMark />
          <span className="text-[15px] font-semibold tracking-tight">Glass</span>
          <span
            className={cn(
              "ml-1 hidden rounded-md px-1.5 py-0.5 text-[10.5px] font-medium sm:inline",
              slide.tone === "dark"
                ? "bg-white/10 text-white/70"
                : "bg-ink-900/8 text-ink-600",
            )}
          >
            pitch
          </span>
        </Link>
        <div
          className={cn(
            "flex items-center gap-3 text-[12px]",
            slide.tone === "dark" ? "text-white/45" : "text-ink-500",
          )}
        >
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Keyboard className="h-3.5 w-3.5" />
            Arrow keys
          </span>
          <span className="tnum tabular-nums">
            {index + 1} / {slides.length}
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-y-auto px-5 pb-6 sm:px-8 sm:pb-8">
        <div
          key={slide.id}
          className={cn(
            "flex flex-1 flex-col justify-center py-3 sm:py-6",
            entered ? "pitch-enter" : "opacity-0",
          )}
        >
          {slide.kicker ? (
            <p
              className={cn(
                "text-[11.5px] font-medium uppercase tracking-[0.14em] sm:text-[12px] sm:tracking-[0.16em]",
                slide.tone === "dark" ? "text-glass-300" : "text-glass-700",
              )}
            >
              {slide.kicker}
            </p>
          ) : null}

          <h1
            className={cn(
              "mt-3 max-w-4xl text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] sm:mt-4 sm:text-[44px] sm:leading-[1.05]",
              slide.id === "title" && "sm:text-[52px]",
            )}
          >
            {slide.headline}
          </h1>

          {slide.support ? (
            <p
              className={cn(
                "mt-4 max-w-3xl text-[15px] leading-relaxed sm:mt-5 sm:text-[17px]",
                slide.tone === "dark" ? "text-white/65" : "text-ink-600",
              )}
            >
              {slide.support}
            </p>
          ) : null}

          {slide.body?.length ? (
            <div
              className={cn(
                "mt-5 max-w-3xl space-y-3 text-[14px] leading-relaxed sm:text-[15px]",
                slide.tone === "dark" ? "text-white/70" : "text-ink-700",
              )}
            >
              {slide.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          ) : null}

          {slide.figures?.length ? (
            <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:mt-10 sm:grid-cols-3">
              {slide.figures.map((fig) => (
                <div key={fig.label} className="bg-ink-950/80 px-4 py-4 sm:px-5">
                  <dt
                    className={cn(
                      "text-[10.5px] font-medium uppercase tracking-[0.08em]",
                      "text-white/40",
                    )}
                  >
                    {fig.label}
                  </dt>
                  <dd className="tnum mt-1 text-[22px] font-semibold tracking-tight sm:text-[26px]">
                    {fig.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {slide.bullets?.length ? (
            <ul className="mt-7 max-w-3xl space-y-3">
              {slide.bullets.map((b) => (
                <li key={b} className="flex gap-3 text-[14px] leading-relaxed sm:text-[15px]">
                  <span
                    className={cn(
                      "mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full",
                      slide.tone === "dark" ? "bg-glass-400" : "bg-glass-600",
                    )}
                  />
                  <span
                    className={
                      slide.tone === "dark" ? "text-white/75" : "text-ink-700"
                    }
                  >
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {slide.columns?.length ? (
            <div
              className={cn(
                "mt-8 grid gap-4 sm:grid-cols-2",
                slide.columns.length >= 3 && "lg:grid-cols-3",
                slide.columns.length === 4 && "lg:grid-cols-2 xl:grid-cols-4",
              )}
            >
              {slide.columns.map((col, i) => (
                <div
                  key={col.title}
                  className={cn(
                    "pitch-stagger rounded-xl border px-4 py-4 sm:px-5 sm:py-5",
                    slide.tone === "dark"
                      ? "border-white/10 bg-white/[0.04]"
                      : "border-ink-200/80 bg-white/70",
                  )}
                  style={{ animationDelay: `${80 + i * 70}ms` }}
                >
                  <h2 className="text-[14px] font-semibold tracking-tight">
                    {col.title}
                  </h2>
                  <p
                    className={cn(
                      "mt-2 text-[13px] leading-relaxed sm:text-[13.5px]",
                      slide.tone === "dark" ? "text-white/60" : "text-ink-600",
                    )}
                  >
                    {col.body}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {slide.steps?.length ? (
            <ol
              className={cn(
                "mt-6 grid gap-2.5 sm:mt-7",
                slide.steps.length > 3
                  ? "sm:grid-cols-2 lg:grid-cols-3"
                  : "lg:grid-cols-3",
              )}
            >
              {slide.steps.map((step, i) => (
                <li
                  key={step.n + step.title}
                  className={cn(
                    "pitch-stagger flex gap-3 rounded-xl border px-3.5 py-3 sm:px-4 sm:py-3.5",
                    slide.tone === "dark"
                      ? "border-white/10 bg-white/[0.04]"
                      : "border-ink-200/80 bg-white/70",
                  )}
                  style={{ animationDelay: `${70 + i * 60}ms` }}
                >
                  <span
                    className={cn(
                      "tnum text-[13px] font-semibold",
                      slide.tone === "dark" ? "text-glass-300" : "text-glass-700",
                    )}
                  >
                    {step.n}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[13.5px] font-semibold tracking-tight sm:text-[14px]">
                      {step.title}
                    </h2>
                    <p
                      className={cn(
                        "mt-1 text-[12.5px] leading-relaxed sm:text-[13px]",
                        slide.tone === "dark" ? "text-white/60" : "text-ink-600",
                      )}
                    >
                      {step.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {slide.cta ? (
            <div className="mt-8">
              <Link
                href={slide.cta.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition",
                  slide.tone === "dark"
                    ? "bg-glass-400 text-ink-950 hover:bg-glass-300"
                    : "bg-ink-900 text-white hover:bg-ink-800",
                )}
              >
                {slide.cta.label}
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </Link>
            </div>
          ) : null}

          {slide.footer ? (
            <p
              className={cn(
                "mt-8 max-w-3xl text-[12.5px] leading-relaxed sm:mt-10",
                slide.tone === "dark" ? "text-white/40" : "text-ink-500",
              )}
            >
              {slide.footer}
            </p>
          ) : null}
        </div>
      </main>

      <footer
        className={cn(
          "relative z-10 shrink-0 border-t px-5 py-3 sm:px-8",
          slide.tone === "dark" ? "border-white/5" : "border-ink-200/60 bg-white/40",
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={isFirst}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition disabled:opacity-30",
              slide.tone === "dark"
                ? "border-white/10 text-white/70 hover:bg-white/5"
                : "border-ink-200 text-ink-600 hover:bg-white",
            )}
            aria-label="Previous slide"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-thin"
            aria-label="Slides"
          >
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition",
                  i === index
                    ? slide.tone === "dark"
                      ? "bg-white/15 text-white"
                      : "bg-ink-900 text-white"
                    : slide.tone === "dark"
                      ? "text-white/40 hover:text-white/70"
                      : "text-ink-400 hover:text-ink-700",
                )}
              >
                {s.rail}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={isLast}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition disabled:opacity-30",
              slide.tone === "dark"
                ? "bg-glass-400 text-ink-950 hover:bg-glass-300"
                : "bg-glass-700 text-white hover:bg-glass-800",
            )}
            aria-label="Next slide"
          >
            {isLast ? "Done" : "Next"}
            {!isLast ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </div>
      </footer>
    </div>
  );
}

function GlassMark() {
  return (
    <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-glass-300 to-glass-600">
      <span className="h-3 w-3 rounded-[3px] border-[1.5px] border-white/85" />
    </span>
  );
}

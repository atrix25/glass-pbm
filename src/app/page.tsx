import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/roles";
import { signIn } from "@/app/actions/session";
import { formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function bookStats() {
  const [members, claims, paid] = await Promise.all([
    prisma.member.count(),
    prisma.claim.count(),
    prisma.claim.aggregate({
      where: { responseStatus: "P" },
      _sum: { totalBilledCents: true },
    }),
  ]);
  return {
    members,
    claims,
    totalBilledCents: paid._sum.totalBilledCents ?? 0,
  };
}

export default async function LoginPage() {
  const stats = await bookStats();

  return (
    <main className="flex min-h-dvh flex-col bg-ink-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-6 sm:py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <GlassMark />
            <span className="text-[15px] font-semibold tracking-tight">Glass</span>
            <span className="ml-1 hidden rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-white/70 sm:inline">
              proof of concept
            </span>
          </div>
          <a
            href="https://etf.wi.gov/boards/groupinsurance/2025/11/12/gib13ca/direct"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 py-2 text-[13px] whitespace-nowrap text-white/60 transition hover:text-white"
          >
            {/* The full label costs two lines on a phone and pushes into the
                logo, so the short one is not decoration. */}
            <span className="hidden sm:inline">Source contract and audit</span>
            <span className="sm:hidden">Sources</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </header>

        <div className="mt-10 grid flex-1 gap-10 sm:mt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div className="max-w-xl">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-glass-300 sm:text-[12px] sm:tracking-[0.16em]">
              Transparent pharmacy benefit management
            </p>
            <h1 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] sm:mt-4 sm:text-[42px] sm:leading-[1.08]">
              Every dollar shows
              {/* Breaking by hand is right at the width the line was written
                  for, and wrong at every narrower one. */}
              <br className="hidden sm:inline" />{" "}
              its derivation.
            </h1>
            <p className="mt-4 text-[14.5px] leading-relaxed text-white/65 sm:mt-5 sm:text-[15px]">
              A working PBM running a book of business for Steel Potatoes LLC,
              a self-insured employer, on a real published contract: Wisconsin
              Department of Employee Trust Funds and Navitus, contract ETG0013.
              The rate card, the formulary, the clinical criteria, and the
              acquisition-cost benchmark are all public documents. This system
              adjudicates against them and shows the arithmetic on every claim.
            </p>

            <dl className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:mt-10">
              <LandingStat
                label="Simulated members"
                value={formatNumber(stats.members)}
              />
              <LandingStat
                label="Claims adjudicated"
                value={formatNumber(stats.claims)}
              />
              <LandingStat
                label="Plan cost, 2026"
                value={formatCentsCompact(stats.totalBilledCents)}
              />
            </dl>

            <p className="mt-6 text-[12.5px] leading-relaxed text-white/45 sm:mt-8 sm:text-[13px]">
              Steel Potatoes is invented, and so are its members and their
              claims, generated to match the published ET-8933 program
              statistics. The rules they run through are not. The plan year is
              seeded end to end and the book advances a day at a time, so what
              you see is the year through today rather than a finished report.
            </p>
          </div>

          <div>
            <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-white/45">
              Sign in as
            </h2>
            <div className="mt-4 space-y-2.5">
              {ROLES.map((role) => (
                <form key={role.id} action={signIn}>
                  <input type="hidden" name="role" value={role.id} />
                  <button
                    type="submit"
                    className="group flex w-full items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition hover:border-glass-400/50 hover:bg-white/[0.07] sm:gap-4 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      {/* Stacked on a phone. Side by side, the role name wraps
                          to two lines while the description beside it is
                          truncated, which reads as broken rather than tight. */}
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                        <span className="text-[14.5px] font-semibold tracking-tight">
                          {role.label}
                        </span>
                        <span className="text-[12px] text-white/40 sm:truncate">
                          {role.who}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
                        {role.blurb}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-glass-300" />
                  </button>
                </form>
              ))}
            </div>

            <Link
              href="/proof"
              className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-white/15 px-4 py-3.5 text-[13px] text-white/60 transition hover:border-white/30 hover:text-white sm:px-5"
            >
              <span>
                Skeptical? Start at the correctness proof instead.
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Link>
          </div>
        </div>

        <footer className="mt-12 border-t border-white/10 pt-6 text-[12px] leading-relaxed text-white/35 sm:mt-16">
          No real member data. AWP is proprietary and unpublished, so
          every figure that depends on it is badged as such throughout the
          application.
        </footer>
      </div>
    </main>
  );
}

function LandingStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-950 px-3 py-3.5 sm:px-4 sm:py-4">
      <div className="text-[9.5px] font-medium uppercase tracking-[0.06em] text-white/40 sm:text-[10.5px] sm:tracking-[0.08em]">
        {label}
      </div>
      <div className="tnum mt-1 text-[16px] font-semibold tracking-tight sm:text-[19px]">
        {value}
      </div>
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

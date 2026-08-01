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
    <main className="flex min-h-screen flex-col bg-ink-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GlassMark />
            <span className="text-[15px] font-semibold tracking-tight">Glass</span>
            <span className="ml-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide text-white/70">
              proof of concept
            </span>
          </div>
          <a
            href="https://etf.wi.gov/boards/groupinsurance/2025/11/12/gib13ca/direct"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-white/60 transition hover:text-white"
          >
            Source contract and audit
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </header>

        <div className="mt-16 grid flex-1 gap-14 lg:grid-cols-[1.05fr_1fr]">
          <div className="max-w-xl">
            <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-glass-300">
              Transparent pharmacy benefit management
            </p>
            <h1 className="mt-4 text-[42px] font-semibold leading-[1.08] tracking-[-0.02em]">
              Every dollar shows
              <br />
              its derivation.
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-white/65">
              A working PBM built on a real, published contract: Wisconsin
              Department of Employee Trust Funds and Navitus, contract ETG0013.
              The rate card, the formulary, the clinical criteria, and the
              acquisition-cost benchmark are all public documents. This system
              adjudicates against them and shows the arithmetic on every claim.
            </p>

            <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
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

            <p className="mt-8 text-[13px] leading-relaxed text-white/45">
              Membership and claims are synthetic, generated to match the
              published ET-8933 program statistics. The rules they run through
              are not.
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
                    className="group flex w-full items-start gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left transition hover:border-glass-400/50 hover:bg-white/[0.07]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-semibold tracking-tight">
                          {role.label}
                        </span>
                        <span className="truncate text-[12px] text-white/40">
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
              className="mt-5 flex items-center justify-between rounded-xl border border-dashed border-white/15 px-5 py-3.5 text-[13px] text-white/60 transition hover:border-white/30 hover:text-white"
            >
              <span>
                Skeptical? Start at the correctness proof instead.
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <footer className="mt-16 border-t border-white/10 pt-6 text-[12px] leading-relaxed text-white/35">
          No real member data. Prices for the AWP benchmark are simulated
          because AWP is proprietary and unpublished; every figure that depends
          on it is badged as such throughout the application.
        </footer>
      </div>
    </main>
  );
}

function LandingStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-950 px-4 py-4">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/40">
        {label}
      </div>
      <div className="tnum mt-1 text-[19px] font-semibold tracking-tight">
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

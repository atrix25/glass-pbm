/**
 * Pitch deck copy for `/pitch`.
 *
 * Kept as data so the deck UI stays a thin shell and the argument can be
 * edited without touching presentation chrome. Numbers that depend on the
 * live book are filled in at render time by the page.
 */

export interface PitchFigure {
  value: string;
  label: string;
}

export interface PitchSlide {
  id: string;
  /** Short label in the progress rail. */
  rail: string;
  /** Title-tone (dark) or content-tone (light ink on pale ground). */
  tone: "dark" | "light";
  /** Optional kicker above the headline. */
  kicker?: string;
  headline: string;
  /** One supporting sentence. Keep it to one job. */
  support?: string;
  body?: string[];
  bullets?: string[];
  figures?: PitchFigure[];
  steps?: { n: string; title: string; detail: string }[];
  columns?: { title: string; body: string }[];
  footer?: string;
  cta?: { label: string; href: string };
}

export function buildPitchSlides(live: {
  lives: string;
  claims: string;
  sources: string;
}): PitchSlide[] {
  return [
    {
      id: "title",
      rail: "Glass",
      tone: "dark",
      kicker: "Transparent pharmacy benefit management",
      headline: "Every dollar shows its derivation.",
      support:
        "A working pass-through PBM on a real published contract — Wisconsin ETF / Navitus ETG0013 — where plan-billed equals pharmacy-paid, and every claim can prove it.",
      figures: [
        { value: live.lives, label: "Covered lives in the demo book" },
        { value: live.claims, label: "Claims adjudicated end to end" },
        { value: live.sources, label: "Public source documents, hashed" },
      ],
      footer:
        "Steel Potatoes LLC is invented. The contract, formulary, clinical criteria, and audit findings are not.",
    },
    {
      id: "problem",
      rail: "Problem",
      tone: "light",
      kicker: "The gap nobody can see",
      headline: "Traditional PBMs make margin where the plan cannot look.",
      support:
        "They bill the employer on one rate table and pay the pharmacy on another. That difference — the spread — is not disclosed. Guarantees are measured by the party that owes them, from data the other party cannot see.",
      bullets: [
        "Spread pricing hides the real take inside every fill.",
        "Rebate definitions are narrowed until the word no longer means what a sponsor thinks it means.",
        "Annual audits find the same failures years late — quantity limits that never fired, pass-through that did not pass through.",
        "Dashboards built on PBM-supplied summaries are not oversight. They are marketing.",
      ],
      footer: "If you cannot recompute a claim, you do not know what you paid for.",
    },
    {
      id: "proof-point",
      rail: "Proof",
      tone: "dark",
      kicker: "Anchored in public paper",
      headline: "We did not invent the contract. We encoded it.",
      support:
        "Glass runs against the best published pass-through terms, the best published auditor findings, and the best published spread counterfactual — so the demo is an argument, not a brochure.",
      columns: [
        {
          title: "Wisconsin ETG0013",
          body: "Navitus pass-through rate card, formulary, and clinical criteria. Admin at $2.10 PMPM. 100% rebate pass-through after the published fee. Spread is structurally impossible.",
        },
        {
          title: "PillarRx audits",
          body: "Independent findings Wisconsin already paid for — including quantity limits that failed to fire — encoded as detectors the book must catch.",
        },
        {
          title: "Michigan OptumRx",
          body: "A real published spread schedule used as the counterfactual. Same fills, different economics. The gap is the pitch.",
        },
      ],
    },
    {
      id: "product",
      rail: "Product",
      tone: "light",
      kicker: "What Glass is",
      headline: "A recomputable pass-through engine — not a dashboard on someone else's math.",
      support:
        "Eligibility, coverage, utilization management, lesser-of pricing, cost share, and rebates run in order. Every stage writes inputs, outputs, and the published document it was read from.",
      bullets: [
        "Open any claim: the engine re-derives it live and reports whether the stored figures agree.",
        "Change the benefit: affected claims re-adjudicate before the change is committed.",
        "Compare contracts: the same book prices under pass-through and under a traditional spread schedule.",
        "Settle guarantees continuously from sponsor-visible records — not from an opaque annual report.",
      ],
      cta: { label: "Open the guided walkthrough", href: "/walkthrough" },
    },
    {
      id: "transparency",
      rail: "Transparency",
      tone: "dark",
      kicker: "What “transparent” actually means",
      headline: "A stored trace is a log. A reproduction is a proof.",
      columns: [
        {
          title: "Derivation",
          body: "Every dollar on a claim shows which rule fired, which benchmark it read, and which document authorized it.",
        },
        {
          title: "Citation",
          body: "Rule-bearing steps must cite a source document. No silent defaults dressed up as policy.",
        },
        {
          title: "Labeled honesty",
          body: "Real, derived, and invented layers are named. AWP stand-ins and modeled pharmacy rates are badged, not buried.",
        },
        {
          title: "Harness",
          body: "Golden tests and book-wide invariants run as evidence — including what the system refuses to claim.",
        },
      ],
      footer: "Credibility is what you refuse to pretend. The methodology page leads with limitations.",
    },
    {
      id: "economics",
      rail: "Economics",
      tone: "light",
      kicker: "Where the money actually goes",
      headline: "Pass-through admin is a line item. Spread is a business model.",
      support:
        "On this book, program integrity, prior auth, settlement, and member service sit inside a published administrative fee. Under a traditional contract, the same fills carry a spread take the plan never sees as a fee.",
      columns: [
        {
          title: "Glass / ETG0013",
          body: "$2.10 PMPM commercial admin. Plan billed equals pharmacy paid — checked as an invariant on every paid claim. Rebates pass through after the published admin fee.",
        },
        {
          title: "Traditional counterfactual",
          body: "Michigan OptumRx Schedule B on the same fills. Separate client and pharmacy rate tables. The gap is retained by the PBM and does not appear as “admin.”",
        },
      ],
      bullets: [
        "A guarantee measured by the party that owes it, from data the other party cannot see, is not a guarantee.",
        "A PBM is a payments company wearing a clinical hat — settlement, float, and remits are the product, not a back office.",
      ],
      cta: { label: "See contract reporting", href: "/reports" },
    },
    {
      id: "gtm",
      rail: "Wedge",
      tone: "dark",
      kicker: "How we sell it",
      headline: "Land with proof. Expand into the operating system.",
      steps: [
        {
          n: "01",
          title: "Glass Audit / Proof",
          detail:
            "Run historical claims through the engine. Produce derivations, guarantee scorecards, and spread counterfactuals. Lowest integration cost — consultants and public plans already buy this pain.",
        },
        {
          n: "02",
          title: "Glass Admin",
          detail:
            "Live pass-through adjudication and the change console for one sponsor book. 834 eligibility in; recomputable claims out.",
        },
        {
          n: "03",
          title: "Glass Operating System",
          detail:
            "Prior auth, integrity, settlement, agents, and member service on the same ledger — with hard leashes: nothing that moves money or denies care applies itself.",
        },
      ],
      footer:
        "First ICP: self-insured employers and public plans under audit pressure. Channel: benefits consultants who already sell “transparent PBM” RFPs but cannot verify the incumbent’s math.",
    },
    {
      id: "demo",
      rail: "Demo",
      tone: "light",
      kicker: "Ten minutes",
      headline: "Do not show them a slide. Make them check something.",
      steps: [
        {
          n: "1",
          title: "Live operations",
          detail: "Advance the clock. Prove the book is running, not a fixture.",
        },
        {
          n: "2",
          title: "One claim, fully derived",
          detail: "Watch the engine recompute. Read the source citations.",
        },
        {
          n: "3",
          title: "Prior authorization",
          detail: "Denial → numbered question on the published criteria form.",
        },
        {
          n: "4",
          title: "Change console",
          detail: "Re-price affected claims before a benefit change commits.",
        },
        {
          n: "5",
          title: "Spread counterfactual",
          detail: "Same fills under Michigan rates. Name the dollars kept.",
        },
        {
          n: "6",
          title: "Correctness proof",
          detail: "Harness results and the limitations we will not claim past.",
        },
      ],
      cta: { label: "Start the short tour", href: "/walkthrough" },
    },
    {
      id: "roadmap",
      rail: "Roadmap",
      tone: "dark",
      kicker: "What comes next",
      headline: "Portability and a live claim path — not more charts.",
      columns: [
        {
          title: "Near term",
          body: "Polish the demo spine. Second contract pack. Medi-Span / sponsor-supplied AWP so Exhibit C math stops being simulated. Full formulary and PA catalog ingestion.",
        },
        {
          title: "Next",
          body: "Real 834. Pharmacy network rates or switch connectivity. Settlement with true float accounting. Continuous guarantee settlement as a billed feature.",
        },
        {
          title: "Then",
          body: "Multi-tenant claims store, IdP/RBAC, SOC 2. Agents priced against incumbent unit costs. Medicare/Medicaid only after commercial self-insured is solid.",
        },
      ],
      footer:
        "What we will not build next: another dashboard on PBM-supplied summaries.",
    },
    {
      id: "ask",
      rail: "Ask",
      tone: "light",
      kicker: "The close",
      headline: "Put your book on an engine you can check.",
      support:
        "Bring eligibility and network contracts. Keep the derivation story. Leave the gap where traditional managers make their margin.",
      bullets: [
        "Pilot: run twelve months of historical claims through Glass Audit / Proof.",
        "Compare: pass-through identity vs. your incumbent’s take on the same fills.",
        "Decide: admin fee you can see, or spread you cannot.",
      ],
      cta: { label: "Open the live proof of concept", href: "/" },
      footer:
        "Glass — transparent PBM proof of concept. No real member PHI. AWP figures badged as simulated where proprietary benchmarks are unpublished.",
    },
  ];
}

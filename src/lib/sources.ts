/**
 * The registry of published documents this system derives its rules from.
 *
 * Nothing in the adjudication engine is allowed to assert a rate, a benefit
 * rule, a formulary placement, or a clinical criterion without pointing at an
 * entry here. Each entry carries a URL a skeptic can open.
 *
 * Verified reachable at time of authoring.
 */

export type SourceKind =
  | "contract"
  | "benefit"
  | "formulary"
  | "pa-criteria"
  | "price-file"
  | "audit"
  | "statute"
  | "report";

export interface SourceDefinition {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: SourceKind;
  publishedDate?: string;
  locator?: string;
  notes?: string;
}

export const SOURCES: SourceDefinition[] = [
  // ---------------------------------------------------------------------
  // Contract ETG0013 — Wisconsin ETF and Navitus Health Solutions
  // ---------------------------------------------------------------------
  {
    id: "etg0013-amd1-exhibit-c",
    title:
      "Contract ETG0013 Amendment #1 — Program Agreement and Exhibit C, Guaranteed Pricing Terms",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%231%20ETG0013%20-%20extension%2C%20revised%20Ex.%201%2C%20new%20Ex.%20C.pdf",
    kind: "contract",
    publishedDate: "2018-06-13",
    locator: "Exhibit C, Guaranteed Pricing Terms, January 1 2019 – December 31 2019",
    notes:
      "The only complete published rate card for ETG0013. Exhibits D (2020-21) and E (2022-24) are referenced in the order of precedence but their amendment PDFs are image-only cover pages with no attached exhibit.",
  },
  {
    id: "etg0013-amd5-gpo",
    title: "Contract ETG0013 Amendment #5 — Group Purchasing Organization arrangement",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%235%20ETG0013.pdf",
    kind: "contract",
    publishedDate: "2021-11-05",
    locator: "Amendment 5A",
    notes:
      "Establishes the GPO through which most manufacturer contracts are held, and the $0.40 PMPM rebate administration fee collected from rebates before pass-through.",
  },
  {
    id: "etg0013-amd7-rebate",
    title: "Contract ETG0013 Amendment #7 — Rebate guarantee recalculation",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%237%20ETG0013.pdf",
    kind: "contract",
    publishedDate: "2024-06-18",
    notes:
      "States the rebate substitution arithmetic for Humira biosimilars and insulin explicitly.",
  },

  // ---------------------------------------------------------------------
  // Benefit design
  // ---------------------------------------------------------------------
  {
    id: "etf-uniform-pharmacy-coc-2026",
    title: "Uniform Pharmacy Benefits — Certificate of Coverage, plan year 2026",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/publications/26et-2107upb/download?inline=",
    kind: "benefit",
    publishedDate: "2026",
    notes:
      "Four benefit levels, cost share amounts, the dual out-of-pocket limit structure, the DAW-1 penalty, the Level 4 channel restriction, and day-supply rules.",
  },
  {
    id: "etf-decision-guide-2026",
    title: "It's Your Choice 2026 Decision Guide",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/publications/26et-2107/download?inline=",
    kind: "benefit",
    publishedDate: "2026",
  },

  // ---------------------------------------------------------------------
  // Formulary and clinical criteria
  // ---------------------------------------------------------------------
  {
    id: "navitus-etf-formulary-2026",
    title: "State of Wisconsin Group Health Insurance Program Formulary",
    publisher: "Navitus Health Solutions",
    url: "https://benefitplans.navitus.com/etf",
    kind: "formulary",
    publishedDate: "2026-07-01",
    notes:
      "259-page fixed-width listing: Drug Name | Special Code | Level | Category, with quantity limits and diagnosis restrictions inline in the drug name field.",
  },
  {
    id: "navitus-pa-forms",
    title: "Navitus Prior Authorization Forms — commercial catalog",
    publisher: "Navitus Health Solutions",
    url: "https://mx.navitus.com/v1/PortalDocuments/Documents?previousCardID=PUBLIC87601*NVETF&formCategoryID=1",
    kind: "pa-criteria",
    publishedDate: "2026",
    notes:
      "438 drug-specific forms carrying full clinical criteria. Retrieved through an undocumented JSON endpoint and cached locally; the endpoint is treated as fragile.",
  },
  {
    id: "navitus-pa-process",
    title: "Navitus Prior Authorization Process",
    publisher: "Navitus Health Solutions",
    url: "https://navitus.com/resource/prior-authorization-process/",
    kind: "pa-criteria",
    notes:
      "Urgent determinations within 24 hours. On weekends and holidays the pharmacy may dispense a five-day supply with no member copay.",
  },

  // ---------------------------------------------------------------------
  // Price files
  // ---------------------------------------------------------------------
  {
    id: "cms-nadac",
    title: "National Average Drug Acquisition Cost (NADAC)",
    publisher: "Centers for Medicare & Medicaid Services",
    url: "https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704",
    kind: "price-file",
    notes:
      "The only public acquisition-cost benchmark. Survey of invoice prices from retail community pharmacies, refreshed weekly. Generic rates use a three-month moving average as of December 2024.",
  },
  {
    id: "simulated-awp",
    title: "Simulated AWP benchmark",
    publisher: "Glass (this system)",
    url: "/methodology#awp",
    kind: "price-file",
    notes:
      "Average Wholesale Price is proprietary to Medi-Span and First Databank and is not published anywhere. Exhibit C states Medi-Span is Navitus' only source of drug pricing data. This system derives a stand-in from NADAC using published multipliers that differ by product type, because brand and generic AWP sit at very different distances above acquisition cost, and badges every figure that depends on it. See the AWP sensitivity analysis for what that opacity costs a plan sponsor.",
  },

  // ---------------------------------------------------------------------
  // Independent audits — the external validation target
  // ---------------------------------------------------------------------
  {
    id: "pillarrx-audit-2025",
    title:
      "PBM Audit Executive Summary — EGWP 2023 and Commercial 2024",
    publisher: "PillarRx Consulting for Wisconsin ETF Group Insurance Board",
    url: "https://etf.wi.gov/boards/groupinsurance/2025/11/12/gib13ca/direct",
    kind: "audit",
    publishedDate: "2025-10-16",
    notes:
      "Re-priced 100% of claims and re-adjudicated 100% against a model of the benefit plan. Commercial 2024: 2,121,246 claims, $384,702,452.94 net plan paid, expected ingredient cost $364,517,317.19 against actual $350,192,332.72.",
  },
  {
    id: "etf-audit-memo-2025",
    title: "Group Insurance Board memo — Pharmacy Benefit Manager Audit",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/boards/groupinsurance/2025/11/12/gib13c/direct",
    kind: "audit",
    publishedDate: "2025-11-12",
  },
  {
    id: "etf-audit-memo-2024",
    title: "Group Insurance Board memo — PBM Audit, EGWP 2022 and Commercial 2023",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/boards/groupinsurance/2024/11/13/gib17a/direct",
    kind: "audit",
    publishedDate: "2024-11-13",
    notes:
      "Commercial 2023: contracted ingredient cost $369,745,996.48 against actual $349,577,120.88, a $20,138,845.60 saving beyond guarantee.",
  },

  // ---------------------------------------------------------------------
  // Program statistics used to calibrate the simulated population
  // ---------------------------------------------------------------------
  {
    id: "etf-8933-plan-stats-2025",
    title: "ET-8933 Pharmacy Benefits Fact Sheet — 2025 plan statistics",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/publications/et8933/download?inline=",
    kind: "report",
    publishedDate: "2026-06-08",
    notes:
      "Commercial 211,424 eligible participants, 3,062,138 prescriptions, $321,911,357 total cost. Channel mix and top therapeutic categories by PMPM used to calibrate the synthetic population.",
  },
  {
    id: "etf-performance-guarantees",
    title: "Appendix 2 — Pharmacy Performance Guarantees",
    publisher: "State of Wisconsin Department of Employee Trust Funds",
    url: "https://etf.wi.gov/sites/default/files/2024-04/Appendix%202%20-%20Pharmacy%20Performance%20Guarantees.xlsx",
    kind: "contract",
    notes:
      "Service level definitions with contract section references and penalty amounts: financial accuracy 99%, processing accuracy 99.5%, claims processing within 3 seconds 99.5%, call answer 80% within 30 seconds.",
  },

  // ---------------------------------------------------------------------
  // The traditional-PBM comparator
  // ---------------------------------------------------------------------
  {
    id: "michigan-optumrx-scheduleb",
    title: "State of Michigan Contract 220000001116 — OptumRx, Schedule B Pricing",
    publisher: "Michigan Department of Technology, Management and Budget",
    url: "https://www.michigan.gov/dtmb/-/media/Project/Websites/dtmb/Procurement/Contracts/014/220000001116.pdf",
    kind: "contract",
    publishedDate: "2022-09-01",
    notes:
      "A real, published, traditional spread contract used as the counterfactual. Retail 30 brand AWP-19.50% rising to 19.70%, generic AWP-86.50% rising to 86.80%, $0.60 dispensing fee guarantee, admin fee $1.25 to $1.45 PMPM.",
  },

  // ---------------------------------------------------------------------
  // Regulatory
  // ---------------------------------------------------------------------
  {
    id: "cfr-423-568",
    title: "42 CFR 423.568 — Standard timeframe and notice for coverage determinations",
    publisher: "Code of Federal Regulations",
    url: "https://www.law.cornell.edu/cfr/text/42/423.568",
    kind: "statute",
    notes:
      "72 hours standard. A missed deadline is an adverse determination requiring auto-forward within 24 hours.",
  },
  {
    id: "cfr-423-572",
    title: "42 CFR 423.572 — Expedited coverage determinations",
    publisher: "Code of Federal Regulations",
    url: "https://www.law.cornell.edu/cfr/text/42/423.572",
    kind: "statute",
    notes: "24 hours expedited.",
  },
  {
    id: "cfr-2560-503-1",
    title: "29 CFR 2560.503-1 — ERISA claims procedure",
    publisher: "Code of Federal Regulations",
    url: "https://www.ecfr.gov/on/2021-09-21/title-29/subtitle-B/chapter-XXV/subchapter-G/part-2560/section-2560.503-1",
    kind: "statute",
    notes: "72 hours urgent care, 15 days pre-service with one 15-day extension.",
  },
];

export const SOURCE_BY_ID: Record<string, SourceDefinition> = Object.fromEntries(
  SOURCES.map((s) => [s.id, s]),
);

export function getSource(id: string): SourceDefinition {
  const source = SOURCE_BY_ID[id];
  if (!source) throw new Error(`Unknown source document: ${id}`);
  return source;
}

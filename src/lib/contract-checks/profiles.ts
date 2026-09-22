export const SPONSOR_COOKIE = "glass_demo_sponsor";
export const PROFILES = {
  wisconsin: { name: "Wisconsin", subtitle: "Navitus · ETG0013 · Demo book", source: "https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%237%20ETG0013.pdf", citation: "Amendment 7A · page 3 · effective January 2024", basis: "Published contract amendment", note: "The existing synthetic employer book remains separate from this contract test." },
  tennessee: { name: "Tennessee", subtitle: "CVS Caremark · 2022 audit period", source: "https://www.tn.gov/content/dam/tn/partnersforhealth/documents/archive/2024_audit_monitoring_report_archive.pdf", citation: "June 2024 monitoring report · page 10 · 2022 rebate audit", basis: "Audit-derived obligation", note: "Full contract and manufacturer exhibits are not loaded. Rates, transaction records and deadlines below are synthetic assumptions." },
} as const;
export type SponsorKey = keyof typeof PROFILES;
export function sponsorKey(value?: string): SponsorKey { return value === "tennessee" ? "tennessee" : "wisconsin"; }

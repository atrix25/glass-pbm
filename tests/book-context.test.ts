/**
 * Steel Potatoes regression checklist for the multi-contract workstream.
 *
 * Every PR that touches book scoping, seed, settlement, or contract loading
 * must keep the default Steel Potatoes / ETG0013 path numerically and
 * narratively identical to the pre-branch transparent demo.
 *
 * Checklist (manual or automated):
 * 1. Default book cookie unset → resolveBookContext returns steel-potatoes / etg0013 / PassThrough
 * 2. Sponsor dashboard totals for steel-potatoes exclude michigan-demo claims
 * 3. Pass-through identity: every steel-potatoes paid claim has totalBilledCents === totalAllowedCents
 * 4. Landing, walkthrough, and proof still describe Steel Potatoes / ETG0013 pass-through when default book is active
 * 5. Admin fee math on Steel Potatoes invoices still uses Wisconsin PMPM rates
 * 6. Michigan data is invisible in default aggregations (BookDay / settlement / reports filtered by sponsorId)
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOK,
  MICHIGAN_DEMO_SPONSOR_ID,
  STEEL_POTATOES_CONTRACT_ID,
  STEEL_POTATOES_SPONSOR_ID,
  resolveBookContext,
} from "@/lib/book-context";

describe("book context defaults protect Steel Potatoes", () => {
  it("defaults to Steel Potatoes / ETG0013 pass-through", () => {
    expect(resolveBookContext(undefined)).toEqual(DEFAULT_BOOK);
    expect(resolveBookContext(null)).toEqual(DEFAULT_BOOK);
    expect(resolveBookContext("")).toEqual(DEFAULT_BOOK);
    expect(resolveBookContext("garbage")).toEqual(DEFAULT_BOOK);
    expect(DEFAULT_BOOK.sponsorId).toBe(STEEL_POTATOES_SPONSOR_ID);
    expect(DEFAULT_BOOK.contractId).toBe(STEEL_POTATOES_CONTRACT_ID);
    expect(DEFAULT_BOOK.model).toBe("PassThrough");
  });

  it("resolves the Michigan Traditional book only when explicitly selected", () => {
    const book = resolveBookContext("michigan-demo");
    expect(book.sponsorId).toBe(MICHIGAN_DEMO_SPONSOR_ID);
    expect(book.model).toBe("Traditional");
    expect(book.contractId).toBe("mi-220000001116");
  });
});

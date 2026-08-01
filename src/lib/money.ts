/**
 * Exact money arithmetic.
 *
 * Pharmacy pricing multiplies per-unit prices carrying five decimal places by
 * fractional quantities, then applies percentage discounts. Doing that in
 * floating point produces penny drift, which would undermine every claim this
 * project makes about being provable.
 *
 * So all internal arithmetic happens in integer MICROS (millionths of a
 * dollar). JavaScript numbers represent integers exactly below 2^53, which is
 * 9,007,199,254,740,991 micros, or about $9.0 billion. A plan-year aggregate
 * of $500M is 5e14 micros, comfortably inside that. Rounding to cents happens
 * only at named boundaries, never implicitly.
 */

/** An integer number of millionths of a dollar. */
export type Micros = number;
/** An integer number of cents, the storage representation. */
export type Cents = number;

export const MICROS_PER_DOLLAR = 1_000_000;
export const MICROS_PER_CENT = 10_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function assertSafe(value: number, context: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Money overflow: ${context} produced a non-finite value`);
  }
  if (Math.abs(value) > MAX_SAFE) {
    throw new Error(
      `Money overflow: ${context} exceeded exact integer range (${value})`,
    );
  }
}

/**
 * Convert a decimal price from a source file into micros.
 * NADAC publishes five decimals; anything beyond six is rounded half-up once,
 * here, and never again.
 */
export function fromDecimal(value: number): Micros {
  const micros = Math.round(value * MICROS_PER_DOLLAR);
  assertSafe(micros, `fromDecimal(${value})`);
  return micros;
}

export function fromCents(cents: Cents): Micros {
  const micros = Math.round(cents) * MICROS_PER_CENT;
  assertSafe(micros, `fromCents(${cents})`);
  return micros;
}

export function fromDollars(dollars: number): Micros {
  return fromDecimal(dollars);
}

/** Round micros to whole cents, half away from zero. */
export function toCents(micros: Micros): Cents {
  const sign = micros < 0 ? -1 : 1;
  const abs = Math.abs(micros);
  const cents = Math.floor((abs + MICROS_PER_CENT / 2) / MICROS_PER_CENT);
  assertSafe(cents * sign, `toCents(${micros})`);
  return cents * sign;
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

export function microsToDollars(micros: Micros): number {
  return micros / MICROS_PER_DOLLAR;
}

/** Multiply micros by a plain quantity, staying exact. */
export function multiplyByQuantity(micros: Micros, quantity: number): Micros {
  // Quantity can be fractional (e.g. 2.5 mL). Scale it to an integer of
  // thousandths first, matching NCPDP's three implied decimals on 442-E7.
  const milliQty = Math.round(quantity * 1000);
  const result = Math.round((micros * milliQty) / 1000);
  assertSafe(result, `multiplyByQuantity(${micros}, ${quantity})`);
  return result;
}

/** Apply a basis-point rate. 1820 bps is 18.20%. */
export function applyBps(micros: Micros, bps: number): Micros {
  const result = Math.round((micros * bps) / 10_000);
  assertSafe(result, `applyBps(${micros}, ${bps})`);
  return result;
}

/** Apply a discount expressed in basis points, i.e. keep (1 - bps). */
export function applyDiscountBps(micros: Micros, discountBps: number): Micros {
  return applyBps(micros, 10_000 - discountBps);
}

export function add(...values: Micros[]): Micros {
  const total = values.reduce((sum, v) => sum + v, 0);
  assertSafe(total, `add(${values.join(", ")})`);
  return total;
}

export function subtract(a: Micros, b: Micros): Micros {
  const result = a - b;
  assertSafe(result, `subtract(${a}, ${b})`);
  return result;
}

export function min(...values: Micros[]): Micros {
  if (values.length === 0) throw new Error("min() requires at least one value");
  return values.reduce((lo, v) => (v < lo ? v : lo));
}

export function max(...values: Micros[]): Micros {
  if (values.length === 0) throw new Error("max() requires at least one value");
  return values.reduce((hi, v) => (v > hi ? v : hi));
}

export function clamp(value: Micros, lo: Micros, hi: Micros): Micros {
  return Math.min(Math.max(value, lo), hi);
}

/** Ratio of two micro amounts as a plain number, for effective-rate math. */
export function ratio(numerator: Micros, denominator: Micros): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
});

export function formatCents(cents: Cents): string {
  return usd.format(cents / 100);
}

export function formatCentsWhole(cents: Cents): string {
  return usdWhole.format(cents / 100);
}

/** Abbreviated form for headline figures. Never used where a number must tie out. */
export function formatCentsCompact(cents: Cents): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${(dollars / 1000).toFixed(0)}K`;
  return usdWhole.format(dollars);
}

export function formatMicros(micros: Micros): string {
  return usd.format(micros / MICROS_PER_DOLLAR);
}

/** For per-unit reference prices, where the extra decimals are the point. */
export function formatUnitPrice(value: number): string {
  return usdPrecise.format(value);
}

export function formatBpsAsPercent(bps: number, decimals = 2): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

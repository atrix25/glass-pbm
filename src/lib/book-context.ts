/**
 * Which live book the request is looking at.
 *
 * Glass runs more than one contract. Steel Potatoes on Wisconsin ETG0013 is
 * the default transparent pass-through demo; Michigan OptumRx is an opt-in
 * Traditional comparator. Every dashboard and agent default must resolve here
 * so a second book cannot leak into Steel Potatoes totals by accident.
 */

export const BOOK_COOKIE = "glass_book";

export const STEEL_POTATOES_SPONSOR_ID = "steel-potatoes";
export const STEEL_POTATOES_CONTRACT_ID = "etg0013";

export const MICHIGAN_DEMO_SPONSOR_ID = "michigan-demo";
export const MICHIGAN_CONTRACT_ID = "mi-220000001116";

export type ContractModel = "PassThrough" | "Traditional";

export interface BookDefinition {
  id: string;
  sponsorId: string;
  contractId: string;
  model: ContractModel;
  /** Short label for the chrome switcher. */
  label: string;
  /** Sponsor display name. */
  sponsorName: string;
  /** Contract / rate-card badge. */
  contractBadge: string;
  /** One-line description for the switcher. */
  description: string;
}

export const BOOKS: BookDefinition[] = [
  {
    id: "steel-potatoes",
    sponsorId: STEEL_POTATOES_SPONSOR_ID,
    contractId: STEEL_POTATOES_CONTRACT_ID,
    model: "PassThrough",
    label: "Steel Potatoes",
    sponsorName: "Steel Potatoes LLC",
    contractBadge: "ETG0013",
    description: "Pass-through · Navitus ETG0013",
  },
  {
    id: "michigan-demo",
    sponsorId: MICHIGAN_DEMO_SPONSOR_ID,
    contractId: MICHIGAN_CONTRACT_ID,
    model: "Traditional",
    label: "Lakeside Fabricators",
    sponsorName: "Lakeside Fabricators LLC",
    contractBadge: "220000001116",
    description: "Traditional · OptumRx Schedule B",
  },
];

export const DEFAULT_BOOK = BOOKS[0];

export type BookContext = BookDefinition;

export function bookById(id: string | null | undefined): BookDefinition {
  if (!id) return DEFAULT_BOOK;
  return BOOKS.find((b) => b.id === id || b.sponsorId === id) ?? DEFAULT_BOOK;
}

/**
 * Resolve the active book from a cookie / query value.
 * Unknown values fall back to Steel Potatoes — never to a mix of both.
 */
export function resolveBookContext(
  raw: string | null | undefined,
): BookContext {
  return bookById(raw);
}

export function isPassThrough(book: BookContext): boolean {
  return book.model === "PassThrough";
}

export function isTraditional(book: BookContext): boolean {
  return book.model === "Traditional";
}

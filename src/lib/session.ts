import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_MEMBER_ID, ROLE_BY_ID, type Role } from "@/lib/roles";
import { CLOCK_COOKIE, resolveClock, type SimulationClock } from "@/lib/clock";
import {
  BOOK_COOKIE,
  resolveBookContext,
  type BookContext,
} from "@/lib/book-context";

/**
 * The simulated present for this request.
 *
 * Every query that reads the book should cut against this rather than against
 * `new Date()`, so that pinning the clock moves the whole application together
 * instead of leaving one panel in the real present.
 */
export async function getClock(): Promise<SimulationClock> {
  const jar = await cookies();
  return resolveClock(jar.get(CLOCK_COOKIE)?.value);
}

export async function getRole(): Promise<Role> {
  const jar = await cookies();
  const raw = jar.get("glass_role")?.value;
  if (raw && raw in ROLE_BY_ID) return raw as Role;
  return "sponsor";
}

export async function getActiveMemberId(): Promise<string> {
  const jar = await cookies();
  return jar.get("glass_member")?.value ?? DEFAULT_MEMBER_ID;
}

/**
 * Active live book for this request. Defaults to Steel Potatoes / ETG0013 so
 * every existing dashboard stays on the transparent pass-through demo unless
 * the user explicitly switches.
 */
export async function getBook(): Promise<BookContext> {
  const jar = await cookies();
  return resolveBookContext(jar.get(BOOK_COOKIE)?.value);
}

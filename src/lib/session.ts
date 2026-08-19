import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_MEMBER_ID, ROLE_BY_ID, type Role } from "@/lib/roles";
import { CLOCK_COOKIE, resolveClock, type SimulationClock } from "@/lib/clock";

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

/** Member ids in this book: `mbr-DEMO-0001-01`. */
const MEMBER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The member the session is looking at.
 *
 * The cookie is written by a form and can therefore hold anything, so it is
 * checked against the shape of an id here rather than at each of the two dozen
 * call sites that read it and put it in front of somebody.
 */
export async function getActiveMemberId(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get("glass_member")?.value;
  return raw && MEMBER_ID.test(raw) ? raw : DEFAULT_MEMBER_ID;
}

import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_MEMBER_ID, ROLE_BY_ID, type Role } from "@/lib/roles";
import { CLOCK_COOKIE, resolveClock, type SimulationClock } from "@/lib/clock";
import { demoFeaturesEnabled, tenantDefaultMemberId } from "@/lib/config";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";

/**
 * The simulated present for this request.
 *
 * When DEMO_FEATURES is off, the clock follows wall time (still clamped to the
 * plan year) and ignores the pin cookie.
 */
export async function getClock(): Promise<SimulationClock> {
  if (!demoFeaturesEnabled()) {
    return resolveClock(undefined);
  }
  const jar = await cookies();
  return resolveClock(jar.get(CLOCK_COOKIE)?.value);
}

export async function getRole(): Promise<Role> {
  if (!demoFeaturesEnabled()) {
    const jar = await cookies();
    const user = await sessionUser(jar.get(SESSION_COOKIE)?.value);
    if (user?.role === "plan_sponsor") return "sponsor";
    if (user?.role === "pharmacist") return "pharmacy";
    if (user?.role === "ops" || user?.role === "admin") return "admin";
    return "sponsor";
  }
  const jar = await cookies();
  const raw = jar.get("glass_role")?.value;
  if (raw && raw in ROLE_BY_ID) return raw as Role;
  return "sponsor";
}

export async function getActiveMemberId(): Promise<string> {
  const jar = await cookies();
  return jar.get("glass_member")?.value ?? tenantDefaultMemberId() ?? DEFAULT_MEMBER_ID;
}

export async function getSessionUser() {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

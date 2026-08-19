"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_BY_ID, type Role } from "@/lib/roles";
import {
  CLOCK_COOKIE,
  addDays,
  clampToPlanYear,
  resolveClock,
} from "@/lib/clock";

/**
 * How the session cookies are written.
 *
 * Nothing in the browser reads them — role, member, and clock are all resolved
 * server-side — so they are `httpOnly`, and `sameSite` keeps a third-party page
 * from switching the role out from under whoever is presenting. `secure` is off
 * locally because the dev server is plain HTTP and a secure cookie there is a
 * cookie that never arrives.
 */
const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

const SESSION_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: 60 * 60 * 24 * 30,
};

export async function signIn(formData: FormData) {
  const role = String(formData.get("role") ?? "sponsor") as Role;
  const def = ROLE_BY_ID[role] ?? ROLE_BY_ID.sponsor;
  const jar = await cookies();
  jar.set("glass_role", def.id, SESSION_COOKIE_OPTIONS);
  const memberId = formData.get("memberId");
  if (typeof memberId === "string" && memberId) {
    jar.set("glass_member", memberId, SESSION_COOKIE_OPTIONS);
  }
  redirect(def.landing);
}

export async function switchRole(formData: FormData) {
  const role = String(formData.get("role") ?? "sponsor") as Role;
  const def = ROLE_BY_ID[role] ?? ROLE_BY_ID.sponsor;
  const jar = await cookies();
  jar.set("glass_role", def.id, SESSION_COOKIE_OPTIONS);
  redirect(def.landing);
}

export async function setActiveMember(formData: FormData) {
  const memberId = String(formData.get("memberId") ?? "");
  const jar = await cookies();
  if (memberId) {
    jar.set("glass_member", memberId, SESSION_COOKIE_OPTIONS);
  }
  redirect(internalPath(formData.get("next"), "/assistant"));
}

/**
 * A destination inside this application.
 *
 * The form carries where to go next, and a redirect that forwards a submitted
 * value unexamined will forward `https://elsewhere.example` just as happily as
 * `/assistant` — which is how a link to a trusted host ends up delivering
 * someone to an untrusted one. Anything that is not a single-slash absolute
 * path falls back to the caller's default.
 */
function internalPath(
  value: FormDataEntryValue | null,
  fallback: string,
): string {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

export async function signOut() {
  const jar = await cookies();
  jar.delete("glass_role");
  redirect("/");
}

/**
 * Move the simulated clock forward.
 *
 * Jumping pins the clock, because a demo that keeps drifting while you talk
 * over it is worse than one that holds still. Returning to live unpins it.
 */
export async function advanceClock(formData: FormData) {
  const jar = await cookies();
  const days = Number(formData.get("days") ?? 0);
  const from = resolveClock(jar.get(CLOCK_COOKIE)?.value).now;
  const next = clampToPlanYear(addDays(from, Number.isFinite(days) ? days : 0));
  jar.set(CLOCK_COOKIE, next.toISOString(), {
    ...COOKIE_OPTIONS,
    maxAge: 60 * 60 * 24,
  });
}

export async function resumeLiveClock() {
  const jar = await cookies();
  jar.delete(CLOCK_COOKIE);
}

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
import { BOOK_COOKIE } from "@/lib/book-context";

export async function signIn(formData: FormData) {
  const role = String(formData.get("role") ?? "sponsor") as Role;
  const def = ROLE_BY_ID[role] ?? ROLE_BY_ID.sponsor;
  const jar = await cookies();
  jar.set("glass_role", def.id, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  const memberId = formData.get("memberId");
  if (typeof memberId === "string" && memberId) {
    jar.set("glass_member", memberId, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  redirect(def.landing);
}

export async function switchRole(formData: FormData) {
  const role = String(formData.get("role") ?? "sponsor") as Role;
  const def = ROLE_BY_ID[role] ?? ROLE_BY_ID.sponsor;
  const jar = await cookies();
  jar.set("glass_role", def.id, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(def.landing);
}

export async function setActiveMember(formData: FormData) {
  const memberId = String(formData.get("memberId") ?? "");
  const jar = await cookies();
  if (memberId) {
    jar.set("glass_member", memberId, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  const next = String(formData.get("next") ?? "/assistant");
  redirect(next);
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
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function resumeLiveClock() {
  const jar = await cookies();
  jar.delete(CLOCK_COOKIE);
}

export async function switchBook(formData: FormData) {
  const bookId = String(formData.get("book") ?? "steel-potatoes");
  const jar = await cookies();
  jar.set(BOOK_COOKIE, bookId, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  const next = String(formData.get("next") ?? "/sponsor");
  redirect(next);
}

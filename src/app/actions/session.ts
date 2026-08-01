"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_BY_ID, type Role } from "@/lib/roles";

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

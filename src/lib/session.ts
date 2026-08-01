import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_MEMBER_ID, ROLE_BY_ID, type Role } from "@/lib/roles";

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

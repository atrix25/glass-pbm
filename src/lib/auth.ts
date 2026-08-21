import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

const SESSION_COOKIE = "glass_session";
const SCRYPT_KEYLEN = 64;

export { SESSION_COOKIE };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, SCRYPT_KEYLEN).toString("hex");
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, SCRYPT_KEYLEN);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export async function createSession(userId: string, ttlDays = 14): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function sessionUser(token: string | undefined) {
  if (!token) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.expiresAt < new Date() || !row.user.active) return null;
  return row.user;
}

export type AppRole = "plan_sponsor" | "ops" | "pharmacist" | "readonly" | "admin";

const MUTATING_ROLES: AppRole[] = ["ops", "pharmacist", "admin", "plan_sponsor"];

export function canMutate(role: string): boolean {
  return MUTATING_ROLES.includes(role as AppRole);
}

export function canDecidePa(role: string): boolean {
  return role === "pharmacist" || role === "admin" || role === "ops";
}

export async function verifyApiKey(raw: string) {
  const keyHash = hashToken(raw);
  const row = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!row || !row.active) return null;
  await prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return row;
}

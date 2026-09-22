import { NextResponse } from "next/server";
import { authMode } from "@/lib/config";
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_SECONDS,
  createDemoSession,
  validDemoCredentials,
} from "@/lib/demo-auth";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "login";

  if (action === "logout") {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (token) await destroySession(decodeURIComponent(token));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    res.cookies.set(DEMO_SESSION_COOKIE, "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
    return res;
  }

  const body = (await request.json()) as {
    email?: string;
    password?: string;
  };
  if (authMode() === "basic") {
    const username = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!validDemoCredentials(username, password))
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401 },
      );
    const res = NextResponse.json({ ok: true });
    res.cookies.set(
      DEMO_SESSION_COOKIE,
      createDemoSession(username, password),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: DEMO_SESSION_SECONDS,
      },
    );
    return res;
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user?.passwordHash ||
    !user.active ||
    !verifyPassword(password, user.passwordHash)
  ) {
    return NextResponse.json(
      { error: "Invalid credentials." },
      { status: 401 },
    );
  }

  const token = await createSession(user.id);
  await recordAudit({
    actorId: user.id,
    action: "auth.login",
    entity: "User",
    entityId: user.id,
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 86400,
  });
  return res;
}

/** Bootstrap the first admin when none exist (local / first deploy). */
export async function PUT(request: Request) {
  const count = await prisma.user.count();
  if (count > 0 && process.env.ALLOW_BOOTSTRAP !== "1") {
    return NextResponse.json(
      { error: "Users already exist." },
      { status: 403 },
    );
  }
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
  };
  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "email and password required" },
      { status: 400 },
    );
  }
  const user = await prisma.user.create({
    data: {
      email: body.email.trim().toLowerCase(),
      name: body.name ?? null,
      role: body.role ?? "admin",
      passwordHash: hashPassword(body.password),
    },
  });
  return NextResponse.json({ id: user.id, email: user.email, role: user.role });
}

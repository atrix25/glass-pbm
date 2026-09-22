"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm({ demo = false }: { demo?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth?action=login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      const next = params.get("next") || "/";
      router.replace(
        next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
          ? next
          : "/",
      );
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#f6f8f9",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(380px, 92vw)",
          display: "grid",
          gap: 18,
          padding: 32,
          background: "#fff",
          border: "1px solid #dce4df",
          borderRadius: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>
          glass{" "}
          <span
            style={{
              fontSize: 11,
              color: "#b51e3b",
              letterSpacing: 0,
              marginLeft: 14,
            }}
          >
            CVS Caremark
          </span>
        </h1>
        <p style={{ margin: 0, color: "#667a6e", fontSize: 14 }}>
          Sign in to your plan.
        </p>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          {demo ? "Username" : "Email"}
          <input
            type={demo ? "text" : "email"}
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #dce4df",
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #dce4df",
            }}
          />
        </label>
        {error ? (
          <p style={{ margin: 0, color: "#a30", fontSize: 13 }} role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 4,
            padding: "12px 14px",
            borderRadius: 8,
            border: 0,
            background: "#315e45",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

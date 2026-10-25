"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginDestination } from "@/lib/login-destination";

export default function LoginForm({ demo = false }: { demo?: boolean }) {
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
      // Reload after setting the session cookie so no pre-login route cache is reused.
      window.location.replace(loginDestination(params.get("next")));
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
          sapphire
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

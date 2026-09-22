import { authMode } from "@/lib/config";
import { Suspense } from "react";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading…</main>}>
      <LoginForm demo={authMode() === "basic"} />
    </Suspense>
  );
}

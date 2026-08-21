import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}

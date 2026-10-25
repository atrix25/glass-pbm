import { expect, test } from "vitest";
import { loginDestination } from "../src/lib/login-destination";

test.each([null, "", "/", "/login", "/login?next=/", "//other.test", "/\\other.test", "/\n/other.test", "https://other.test", "javascript:alert(1)"])("sign-in safely defaults to the workspace: %s", next => {
  expect(loginDestination(next)).toBe("/workspace");
});
test("preserves the saved study, selected step and anchor", () => {
  const next = "/plan-studio?study=study_123&step=compare#options";
  expect(loginDestination(next)).toBe(next);
});

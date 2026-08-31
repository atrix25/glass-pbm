import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The invariant and replay suites read the whole seeded book.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Shared Postgres can allow parallel workers; keep single-thread until the
    // suite is split so write-heavy invariants do not race.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    reporters: ["default", ["json", { outputFile: "tests/results.json" }]],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Member-agent tools call getClock via session (server-only). Stub so
      // vitest can collect the suite outside a Next request.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/empty.ts", import.meta.url),
      ),
    },
  },
});

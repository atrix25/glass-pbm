import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The invariant and replay suites read the whole seeded book.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // A shared SQLite file does not want concurrent readers from many workers.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    reporters: ["default", ["json", { outputFile: "tests/results.json" }]],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

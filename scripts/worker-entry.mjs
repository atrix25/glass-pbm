#!/usr/bin/env node
/**
 * Production worker entry — runs the TypeScript worker via tsx.
 * Fly process: `node /app/scripts/worker-entry.mjs`
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = path.join(here, "worker.ts");
const child = spawn("npx", ["tsx", worker], {
  stdio: "inherit",
  env: process.env,
  cwd: path.join(here, ".."),
});
child.on("exit", (code) => process.exit(code ?? 1));

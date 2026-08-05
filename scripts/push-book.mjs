/**
 * Upload the local seeded book onto the Fly volume.
 *
 * The book is too large to bake into every image, so it lives at /data/dev.db
 * on the glass_book volume. Run this whenever the local book has changed and
 * production should see the same figures.
 *
 *   node scripts/push-book.mjs
 */

import { spawn } from "node:child_process";
import { statSync } from "node:fs";

const APP = process.env.FLY_APP ?? "glass-pbm-demo";
const LOCAL = process.env.BOOK_PATH ?? "prisma/dev.db";
const REMOTE = "/data/dev.db";

const sizeGb = (statSync(LOCAL).size / 1e9).toFixed(2);
console.log(`Uploading ${LOCAL} (${sizeGb} GB) to ${APP}:${REMOTE}...`);
console.log("This uses the WireGuard path and usually beats a Docker context upload.");

const child = spawn(
  "flyctl",
  ["ssh", "sftp", "put", LOCAL, REMOTE, "-a", APP],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`sftp put failed with exit ${code}`);
    process.exit(code ?? 1);
  }
  console.log("Book uploaded. Restarting the machine so it reopens the file...");
  const restart = spawn(
    "flyctl",
    [
      "machine",
      "restart",
      ...(process.env.FLY_MACHINE ? [process.env.FLY_MACHINE] : []),
      "-a",
      APP,
    ],
    { stdio: "inherit" },
  );
  restart.on("exit", (r) => process.exit(r ?? 0));
});

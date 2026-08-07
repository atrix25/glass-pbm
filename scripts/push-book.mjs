/**
 * Upload the local seeded book to object storage.
 *
 * Gzip-compresses prisma/dev.db and multipart-uploads to an S3-compatible
 * bucket (R2, Tigris, B2, AWS). Fly machines download it on boot — no WireGuard
 * SFTP required.
 *
 * Required env (local shell or .env):
 *   BOOK_S3_BUCKET       (or BUCKET_NAME from `fly storage create`)
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *
 * Optional:
 *   BOOK_S3_KEY          default glass/dev.db.gz
 *   BOOK_S3_ENDPOINT     (or AWS_ENDPOINT_URL_S3 from Tigris)
 *   BOOK_S3_REGION       default auto
 *   BOOK_PATH            default prisma/dev.db
 *   FLY_APP              default glass-pbm-demo
 *
 * After upload, ensure the same credentials are set as Fly secrets, then
 * restart the machine so it re-downloads (or set BOOK_FORCE_DOWNLOAD=1).
 *
 *   node scripts/push-book.mjs
 */

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { statSync, unlinkSync } from "node:fs";
import { pipeline } from "stream/promises";
import { createGzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { uploadBookGzip, headBookObject } from "./book-storage.mjs";

const APP = process.env.FLY_APP ?? "glass-pbm-demo";
const LOCAL = process.env.BOOK_PATH ?? "prisma/dev.db";
const GZIP = `${LOCAL}.upload.gz`;
const uploadOnly = process.argv.includes("--upload-only");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("flyctl", args, { stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`flyctl ${args[0]} exited ${code}`)),
    );
  });
}

async function primaryMachineId() {
  if (process.env.FLY_MACHINE) return process.env.FLY_MACHINE;
  return new Promise((resolve, reject) => {
    const child = spawn("flyctl", ["machine", "list", "-a", APP, "--json"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`flyctl machine list exited ${code}`));
      const id = JSON.parse(out)[0]?.id;
      if (!id) return reject(new Error("no machines found"));
      resolve(id);
    });
  });
}

const localSize = statSync(LOCAL).size;
console.log(`Checkpointing WAL into ${LOCAL} before upload...`);
{
  const db = new DatabaseSync(LOCAL);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}
console.log(`Compressing ${LOCAL} (${(localSize / 1e9).toFixed(2)} GB)...`);

try {
  await pipeline(createReadStream(LOCAL), createGzip(), createWriteStream(GZIP));
  const gzSize = statSync(GZIP).size;
  console.log(`Compressed to ${(gzSize / 1e6).toFixed(0)} MB.`);

  console.log("Uploading to object storage (multipart, resumable)...");
  const { etag } = await uploadBookGzip(GZIP);
  const remote = await headBookObject();
  console.log(`Upload complete. ETag ${etag}, remote size ${remote.ContentLength} bytes.`);

  console.log("\nEnsure Fly has matching S3 credentials (once):");
  console.log("  fly storage create   # or set BOOK_S3_BUCKET + AWS_* manually");
  console.log("  fly secrets set BOOK_S3_KEY=glass/dev.db.gz -a", APP);

  if (uploadOnly) {
    console.log("\nUpload only (--upload-only). Skipping machine restart.");
    process.exit(0);
  }

  console.log("\nRestarting machine to re-download the book...");
  await run([
    "ssh",
    "console",
    "-a",
    APP,
    "-C",
    "sh -c 'rm -f /data/dev.db /data/dev.db-wal /data/dev.db-shm'",
  ]);
  await run([
    "machine",
    "restart",
    await primaryMachineId(),
    "-a",
    APP,
  ]);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  try {
    unlinkSync(GZIP);
  } catch {
    /* temp file may not exist */
  }
}

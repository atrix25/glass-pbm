/**
 * S3-compatible upload/download for the seeded book.
 *
 * Works with AWS S3, Cloudflare R2, Fly Tigris, Backblaze B2, etc. Configure
 * via environment variables (see scripts/push-book.mjs).
 */

import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export function bookStorageConfig() {
  const bucket = process.env.BOOK_S3_BUCKET ?? process.env.BUCKET_NAME ?? process.env.AWS_BUCKET;
  const key = process.env.BOOK_S3_KEY ?? "glass/dev.db.gz";
  const endpoint =
    process.env.BOOK_S3_ENDPOINT ??
    process.env.AWS_ENDPOINT_URL_S3 ??
    process.env.AWS_ENDPOINT;
  const region = process.env.BOOK_S3_REGION ?? process.env.AWS_REGION ?? "auto";

  if (!bucket) {
    throw new Error(
      "BOOK_S3_BUCKET is required (or set BUCKET_NAME after fly storage create)",
    );
  }

  return { bucket, key, endpoint, region };
}

export function createBookS3Client() {
  const { endpoint, region } = bookStorageConfig();
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

export async function headBookObject() {
  const { bucket, key } = bookStorageConfig();
  const client = createBookS3Client();
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

/** Upload a gzip file; returns remote size and etag. */
export async function uploadBookGzip(localGzipPath) {
  const { bucket, key } = bookStorageConfig();
  const client = createBookS3Client();
  const size = statSync(localGzipPath).size;

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localGzipPath),
      ContentType: "application/gzip",
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });

  upload.on("httpUploadProgress", (p) => {
    if (p.loaded && p.total) {
      const pct = ((100 * p.loaded) / p.total).toFixed(1);
      process.stdout.write(`\r  uploaded ${pct}% (${p.loaded}/${p.total} bytes)`);
    }
  });

  const result = await upload.done();
  process.stdout.write("\n");
  return { size, etag: result.ETag ?? null };
}

/** Download and gunzip into destPath if missing or force=true. */
/** Minimum plausible size for the seeded book (full book is ~1.3 GB). */
const MIN_BOOK_BYTES = 500_000_000;

export async function downloadBookIfNeeded(destPath, { force = false } = {}) {
  const existing = existsSync(destPath) ? statSync(destPath).size : 0;
  if (!force && existing >= MIN_BOOK_BYTES) {
    console.log(`Book already present at ${destPath} (${(existing / 1e9).toFixed(2)} GB), skipping download.`);
    return false;
  }

  if (existing > 0) {
    console.log(
      `Removing incomplete book at ${destPath} (${(existing / 1e6).toFixed(0)} MB; need ≥${(MIN_BOOK_BYTES / 1e9).toFixed(1)} GB).`,
    );
    unlinkSync(destPath);
  }

  const { bucket, key } = bookStorageConfig();
  const client = createBookS3Client();

  console.log(`Downloading s3://${bucket}/${key} → ${destPath}...`);
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) {
    throw new Error("S3 GetObject returned an empty body");
  }

  await pipeline(response.Body, createGunzip(), createWriteStream(destPath));
  const size = statSync(destPath).size;
  console.log(`Book ready (${(size / 1e9).toFixed(2)} GB uncompressed).`);
  return true;
}

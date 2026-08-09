/**
 * S3-compatible upload/download for the seeded book.
 *
 * Works with AWS S3, Cloudflare R2, Fly Tigris, Backblaze B2, etc. Configure
 * via environment variables (see scripts/push-book.mjs).
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

/** Minimum plausible size for the seeded book (full book is ~1.3 GB). */
export const MIN_BOOK_BYTES = 500_000_000;

/**
 * Pre-marker deployments wrote straight to destPath. A book at or above this
 * size is assumed finished (full book ~1.3 GB); anything between MIN_BOOK_BYTES
 * and this floor is the sticky-truncation window and must be re-fetched.
 */
export const LEGACY_TRUST_BYTES = 1_200_000_000;

/** Sidecar written only after a finished download; absence means "do not trust dest". */
export function bookMarkerPath(destPath) {
  return `${destPath}.complete`;
}

function partialPath(destPath) {
  return `${destPath}.partial`;
}

function readMarker(destPath) {
  const marker = bookMarkerPath(destPath);
  if (!existsSync(marker)) return null;
  try {
    return JSON.parse(readFileSync(marker, "utf8"));
  } catch {
    return null;
  }
}

function writeMarker(destPath, uncompressedBytes) {
  writeFileSync(
    bookMarkerPath(destPath),
    JSON.stringify({ uncompressedBytes, finishedAt: new Date().toISOString() }),
  );
}

function removeIfExists(path) {
  if (existsSync(path)) unlinkSync(path);
}

/**
 * True when destPath is a finished book we can serve without re-fetching.
 *
 * A file that merely exists (even above MIN_BOOK_BYTES) is not enough: an
 * interrupted gunzip used to leave a truncated SQLite that every later boot
 * treated as complete. New downloads write a `.complete` marker; unmarked
 * files are trusted only at the legacy full-book floor.
 */
export function localBookIsReady(
  destPath,
  minBytes = MIN_BOOK_BYTES,
  legacyTrustBytes = LEGACY_TRUST_BYTES,
) {
  if (!existsSync(destPath)) return false;
  const size = statSync(destPath).size;
  if (size < minBytes) return false;
  const marker = readMarker(destPath);
  if (marker !== null) return marker.uncompressedBytes === size;

  // One-time migration for volumes populated before markers existed.
  if (size >= legacyTrustBytes) {
    writeMarker(destPath, size);
    return true;
  }
  return false;
}

/**
 * Download and gunzip into destPath if missing, incomplete, or force=true.
 *
 * Bytes land on a `.partial` file and are renamed onto destPath only after the
 * stream finishes, with a `.complete` marker written afterward. A crash mid-
 * download therefore cannot sticky-truncate the live database.
 */
export async function downloadBookIfNeeded(
  destPath,
  { force = false, minBytes = MIN_BOOK_BYTES, client = null } = {},
) {
  if (!force && localBookIsReady(destPath, minBytes)) {
    const size = statSync(destPath).size;
    console.log(
      `Book already present at ${destPath} (${(size / 1e9).toFixed(2)} GB), skipping download.`,
    );
    return false;
  }

  if (existsSync(destPath)) {
    const existing = statSync(destPath).size;
    console.log(
      `Removing untrusted book at ${destPath} (${(existing / 1e6).toFixed(0)} MB; need a finished download ≥${(minBytes / 1e9).toFixed(1)} GB).`,
    );
    removeIfExists(destPath);
  }
  removeIfExists(bookMarkerPath(destPath));
  removeIfExists(partialPath(destPath));

  const { bucket, key } = bookStorageConfig();
  const s3 = client ?? createBookS3Client();
  const tmpPath = partialPath(destPath);

  console.log(`Downloading s3://${bucket}/${key} → ${destPath}...`);
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error("S3 GetObject returned an empty body");
    }

    await pipeline(response.Body, createGunzip(), createWriteStream(tmpPath));
    const size = statSync(tmpPath).size;
    if (size < minBytes) {
      throw new Error(
        `Downloaded book is only ${size} bytes; expected ≥ ${minBytes}`,
      );
    }

    // Publish the bytes first, then the marker. A crash between these steps
    // re-downloads on the next boot rather than serving an unmarked file.
    renameSync(tmpPath, destPath);
    writeMarker(destPath, size);
    console.log(`Book ready (${(size / 1e9).toFixed(2)} GB uncompressed).`);
    return true;
  } catch (err) {
    removeIfExists(tmpPath);
    // Leave any pre-existing dest alone only when we never published this attempt.
    // (We already removed an untrusted dest above.)
    throw err;
  }
}

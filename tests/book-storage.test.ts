/**
 * Boot-time book delivery must never sticky-serve a truncated SQLite.
 *
 * downloadBookIfNeeded used to gunzip straight onto the live path and treat any
 * file ≥ 500 MB as finished. A crash after that floor left a corrupt book that
 * every later boot skipped re-fetching.
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  bookMarkerPath,
  downloadBookIfNeeded,
  LEGACY_TRUST_BYTES,
  localBookIsReady,
} from "../scripts/book-storage.mjs";

const prevBucket = process.env.BOOK_S3_BUCKET;

function tempDir() {
  return mkdtempSync(join(tmpdir(), "glass-book-"));
}

function gzipBody(payload: string | Buffer) {
  const gz = gzipSync(payload);
  return {
    Body: Readable.from(gz),
  };
}

function mockClient(handler: () => { Body: Readable } | { Body?: undefined }) {
  return {
    send: async () => handler(),
  };
}

describe("localBookIsReady", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a large file with no completion marker (the sticky-truncation case)", () => {
    dir = tempDir();
    const dest = join(dir, "dev.db");
    // Stand-in for an interrupted gunzip that crossed the old 500 MB floor
    // but never reached a full-book size.
    writeFileSync(dest, Buffer.alloc(600));
    expect(localBookIsReady(dest, 500)).toBe(false);
  });

  it("accepts only a finished book whose marker matches the byte size", () => {
    dir = tempDir();
    const dest = join(dir, "dev.db");
    writeFileSync(dest, "sqlite-bytes");
    writeFileSync(
      bookMarkerPath(dest),
      JSON.stringify({ uncompressedBytes: Buffer.byteLength("sqlite-bytes") }),
    );
    expect(localBookIsReady(dest, 5)).toBe(true);
    expect(localBookIsReady(dest, 50)).toBe(false);
  });

  it("migrates a legacy full-size book by writing a marker once", () => {
    dir = tempDir();
    const dest = join(dir, "dev.db");
    expect(LEGACY_TRUST_BYTES).toBeGreaterThanOrEqual(1_200_000_000);
    writeFileSync(dest, "legacy-full-book");
    const size = Buffer.byteLength("legacy-full-book");
    // Lower the legacy floor in-test so we do not allocate a gigabyte buffer.
    expect(localBookIsReady(dest, 1, size)).toBe(true);
    expect(existsSync(bookMarkerPath(dest))).toBe(true);
    expect(JSON.parse(readFileSync(bookMarkerPath(dest), "utf8")).uncompressedBytes).toBe(
      size,
    );
  });
});

describe("downloadBookIfNeeded", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (prevBucket === undefined) delete process.env.BOOK_S3_BUCKET;
    else process.env.BOOK_S3_BUCKET = prevBucket;
  });

  it("publishes via temp + marker and skips a second fetch", async () => {
    dir = tempDir();
    process.env.BOOK_S3_BUCKET = "test-bucket";
    const dest = join(dir, "dev.db");
    const payload = "complete-book-payload-0123456789";
    let fetches = 0;

    const client = mockClient(() => {
      fetches++;
      return gzipBody(payload);
    });

    const first = await downloadBookIfNeeded(dest, {
      client,
      minBytes: payload.length,
    });
    expect(first).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe(payload);
    expect(localBookIsReady(dest, payload.length)).toBe(true);
    expect(existsSync(join(dir, "dev.db.partial"))).toBe(false);

    const second = await downloadBookIfNeeded(dest, {
      client,
      minBytes: payload.length,
    });
    expect(second).toBe(false);
    expect(fetches).toBe(1);
  });

  it("does not sticky-skip a truncated file left by the old in-place download", async () => {
    dir = tempDir();
    process.env.BOOK_S3_BUCKET = "test-bucket";
    const dest = join(dir, "dev.db");
    // Corrupt leftover large enough to pass a size floor, with no marker.
    writeFileSync(dest, "truncated-corrupt-book-xxxxxxxxxxxx");
    const payload = "repaired-full-book-contents-abcdef";
    let fetches = 0;

    const client = mockClient(() => {
      fetches++;
      return gzipBody(payload);
    });

    const downloaded = await downloadBookIfNeeded(dest, {
      client,
      minBytes: 10,
    });
    expect(downloaded).toBe(true);
    expect(fetches).toBe(1);
    expect(readFileSync(dest, "utf8")).toBe(payload);
    expect(localBookIsReady(dest, 10)).toBe(true);
  });

  it("leaves no live dest when the stream fails mid-download", async () => {
    dir = tempDir();
    process.env.BOOK_S3_BUCKET = "test-bucket";
    const dest = join(dir, "dev.db");

    const client = {
      send: async () => ({
        Body: new Readable({
          read() {
            this.destroy(new Error("network blip"));
          },
        }),
      }),
    };

    await expect(
      downloadBookIfNeeded(dest, { client, minBytes: 1 }),
    ).rejects.toThrow(/network blip/);

    expect(existsSync(dest)).toBe(false);
    expect(existsSync(bookMarkerPath(dest))).toBe(false);
    expect(existsSync(join(dir, "dev.db.partial"))).toBe(false);
  });

  it("does not treat a leftover .partial as a finished book", async () => {
    dir = tempDir();
    process.env.BOOK_S3_BUCKET = "test-bucket";
    const dest = join(dir, "dev.db");
    const partial = join(dir, "dev.db.partial");
    writeFileSync(partial, "old-partial-bytes-should-be-ignored");

    const payload = "fresh-complete-book";
    const client = mockClient(() => gzipBody(payload));

    await downloadBookIfNeeded(dest, { client, minBytes: payload.length });
    expect(readFileSync(dest, "utf8")).toBe(payload);
    expect(existsSync(partial)).toBe(false);
    expect(statSync(dest).size).toBe(payload.length);
  });
});

/**
 * Boot-time book fetch for Fly production.
 *
 * Called from docker-entrypoint.sh before the Next.js server starts. If the
 * volume has no book yet, pull the gzip object from object storage and expand
 * it onto the glass_book volume at /data/dev.db.
 */

import { downloadBookIfNeeded } from "./book-storage.mjs";

const dest = process.env.BOOK_PATH ?? "/data/dev.db";
const force = process.env.BOOK_FORCE_DOWNLOAD === "1";

try {
  await downloadBookIfNeeded(dest, { force });
} catch (e) {
  console.error("Failed to download book:", e instanceof Error ? e.message : e);
  process.exit(1);
}

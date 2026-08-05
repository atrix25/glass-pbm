import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Wording changes made in the browser, kept in the repository.
 *
 * Copy in this build is written inline in the page files, which is fine for
 * writing it and tedious for revising it: finding the sentence you just read
 * on screen means guessing which of twenty-six page files it lives in and
 * working around the fact that some of them spell an em dash `&mdash;`.
 *
 * The edit layer solves that by keying a replacement off the exact text as
 * rendered, which is the one form of the string the author is certain of,
 * because they are looking at it. This module is where those replacements
 * live.
 *
 * They are a JSON file rather than a database table on purpose. The SQLite
 * book is baked into the container image and the machine has no volume, so
 * anything written to the database in production is discarded by the next
 * deploy. A file in the repository is committed, reviewed, and shipped inside
 * the image like any other source change.
 */

const FILE = path.join(process.cwd(), "content", "copy-overrides.json");

export type CopyOverrides = Record<string, string>;

/**
 * Read on every render, deliberately.
 *
 * An in-process cache was the obvious thing and was wrong: the save route and
 * the layout are separate bundles with separate module registries, so a cache
 * populated by one is invisible to the other, and an edit appeared to save and
 * then vanished on reload. The file is a few kilobytes next to a page that
 * already spends hundreds of milliseconds in SQLite, so reading it each time
 * costs nothing measurable and cannot go stale.
 */
export async function getCopyOverrides(): Promise<CopyOverrides> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as CopyOverrides;
    // A replacement identical to its original is a no-op that would still cost
    // a DOM walk on every page, so they are dropped on the way in.
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([original, replacement]) =>
          typeof replacement === "string" && replacement !== original,
      ),
    );
  } catch {
    // No file yet, or a hand-edit left it unparseable. Either way the site
    // should render its original wording rather than fail to render at all.
    return {};
  }
}

/**
 * Record one replacement, or remove it when the text is put back as it was.
 *
 * Returns false when the file cannot be written, which is the normal case on a
 * deployed machine with a read-only or ephemeral filesystem. The caller tells
 * the author, rather than letting them revise a page of copy that will be
 * gone at the next deploy.
 */
export async function saveCopyOverride(
  original: string,
  replacement: string | null,
): Promise<boolean> {
  const current = { ...(await getCopyOverrides()) };

  if (replacement === null || replacement === original || replacement === "") {
    delete current[original];
  } else {
    current[original] = replacement;
  }

  const sorted = Object.fromEntries(
    Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
  );

  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether edits made now will still be here tomorrow.
 *
 * Used to decide what the toolbar promises. On a laptop this is true and an
 * edit is a file change; on the deployed machine it is false and an edit lasts
 * until the container is replaced.
 */
export async function copyIsPersistable(): Promise<boolean> {
  try {
    // Asking whether the directory is writable, rather than proving it by
    // writing. This runs on every page render, and an earlier version that
    // rewrote the file to test it could have clobbered a save landing at the
    // same moment.
    await mkdir(path.dirname(FILE), { recursive: true });
    await access(path.dirname(FILE), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

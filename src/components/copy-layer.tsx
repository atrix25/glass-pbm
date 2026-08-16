"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import type { CopyOverrides } from "@/lib/copy";

/**
 * Edit the words on the page, on the page.
 *
 * Copy lives inline in twenty-six page files, so revising a sentence normally
 * means finding which file it is in. This turns that around: click the
 * sentence, type over it, and the replacement is stored against the text as it
 * was rendered. The text you are looking at is the key, so there is nothing to
 * find.
 *
 * Two deliberate limits are worth knowing about.
 *
 * Overrides are applied to the DOM after React has hydrated, not to the HTML
 * the server sends. Applying them earlier would mean mutating nodes that React
 * is about to hydrate, and React would treat the difference as a mismatch,
 * patch the original wording back, and warn about it. The cost of waiting is
 * that a page carrying an override can show its original wording for the few
 * milliseconds before hydration finishes.
 *
 * A replacement is keyed by exact text, so it applies everywhere that text
 * appears, and it stops applying if the underlying sentence is later edited in
 * the source. Both are the safe direction to fail in: the site falls back to
 * the wording that is actually written down.
 */

/** Nothing inside these can be copy worth editing. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "PATH",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
]);

/**
 * Live figures can be cleared, but not rewritten into a frozen number.
 *
 * Every number on the site is computed per request. Freezing one into an
 * override would turn a derived figure into a hard-coded one — the exact
 * failure the rest of this build exists to argue against. Number-only text is
 * therefore editable so an author can delete stray figures left behind after
 * clearing surrounding copy, but a non-empty replacement that is still only
 * digits is refused at save time.
 */
const NUMBER_ONLY = /^[\s\d.,%$()+\-–—/:x×]*$/;

function editable(node: Text): boolean {
  const text = node.nodeValue ?? "";
  if (text.trim().length < 1) return false;

  const parent = node.parentElement;
  if (!parent) return false;
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.closest("[data-copy-ui]")) return false;
  if (parent.isContentEditable) return false;

  // Links and buttons keep working while editing.
  //
  // Intercepting their labels too would mean an author could not move between
  // pages without leaving edit mode first, which is most of what you do while
  // revising a site. Their wording is still replaced wherever an override
  // matches it; it just cannot be started from a click here.
  if (parent.closest("a[href], button, [role='button'], summary")) return false;

  return true;
}

function walk(root: Node, visit: (node: Text) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-copy-ui]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    visit(node as Text);
    node = walker.nextNode();
  }
}

/** The text node under the pointer, if there is one worth editing. */
function textNodeAt(x: number, y: number): Text | null {
  let node: Node | null = null;
  let offset = 0;

  // WebKit and Chrome expose the range form; Firefox exposes the position
  // form. Between them every browser this will be demonstrated on is covered.
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  } else if (typeof document.caretPositionFromPoint === "function") {
    const pos = document.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    offset = pos?.offset ?? 0;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node as Text;
  if (!editable(text)) return null;

  caretOffset = offset;
  return text;
}

/** Where in the sentence the author clicked, so the caret lands there. */
let caretOffset = 0;

// ---------------------------------------------------------------------------
// Whether edit mode is on
//
// Kept outside React in a tiny store rather than in state seeded from an
// effect. The setting lives in localStorage, which does not exist while the
// layout renders on the server, and reading it into state after mount is both
// a lint error and a real extra render on every page load.
// ---------------------------------------------------------------------------

const EDIT_KEY = "glass.copyEdit";

let editOn = false;
let readStorage = false;
const editListeners = new Set<() => void>();

function subscribeEdit(notify: () => void) {
  if (!readStorage) {
    readStorage = true;
    try {
      editOn = window.localStorage.getItem(EDIT_KEY) === "on";
    } catch {
      editOn = false;
    }
  }
  editListeners.add(notify);
  return () => {
    editListeners.delete(notify);
  };
}

const editSnapshot = () => editOn;
/** The server has no opinion about edit mode, and never renders it on. */
const editServerSnapshot = () => false;

function setEditOn(on: boolean) {
  editOn = on;
  try {
    window.localStorage.setItem(EDIT_KEY, on ? "on" : "off");
  } catch {
    // A browser refusing storage should still allow editing for this visit.
  }
  for (const notify of editListeners) notify();
}

export function CopyLayer({
  overrides,
  persistable,
}: {
  overrides: CopyOverrides;
  persistable: boolean;
}) {
  const router = useRouter();
  const editing = useSyncExternalStore(
    subscribeEdit,
    editSnapshot,
    editServerSnapshot,
  );
  const [status, setStatus] = useState<string | null>(null);

  // Held in refs because the MutationObserver callback is installed once and
  // must always see the current map rather than the one from first render.
  const overridesRef = useRef(overrides);
  const applyingRef = useRef(false);
  const editingNodeRef = useRef<HTMLElement | null>(null);

  overridesRef.current = overrides;

  /** Original wording, looked up from what is currently on screen. */
  const originalFor = useCallback((rendered: string): string => {
    const map = overridesRef.current;
    if (map[rendered] !== undefined) return rendered;
    for (const [original, replacement] of Object.entries(map)) {
      if (replacement === rendered) return original;
    }
    return rendered;
  }, []);

  const applyAll = useCallback(() => {
    const map = overridesRef.current;
    if (Object.keys(map).length === 0) return;

    applyingRef.current = true;
    walk(document.body, (node) => {
      const raw = node.nodeValue ?? "";
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (!(trimmed in map)) return;
      const replacement = map[trimmed];
      if (replacement === trimmed) return;

      // Keep the surrounding whitespace: JSX leaves newlines and indentation
      // around text, and dropping it closes up spaces between inline elements.
      const lead = raw.slice(0, raw.indexOf(trimmed[0]));
      const tail = raw.slice(raw.lastIndexOf(trimmed[trimmed.length - 1]) + 1);
      node.nodeValue = `${lead}${replacement}${tail}`;
    });
    applyingRef.current = false;
  }, []);

  // Apply on mount, and again whenever React replaces the text it owns, which
  // it does on every client navigation and every refresh.
  useEffect(() => {
    applyAll();

    let queued = false;
    const observer = new MutationObserver(() => {
      if (applyingRef.current || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        applyAll();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [applyAll, overrides]);

  useEffect(() => {
    document.body.dataset.copyEdit = editing ? "on" : "off";
    if (!editing) clearHighlight();
  }, [editing]);

  // ---------------------------------------------------------------------
  // Hover target
  // ---------------------------------------------------------------------

  const highlightedRef = useRef<HTMLElement | null>(null);

  function clearHighlight() {
    if (highlightedRef.current) {
      highlightedRef.current.removeAttribute("data-copy-hover");
      highlightedRef.current = null;
    }
  }

  useEffect(() => {
    if (!editing) return;

    let queued = false;
    const onMove = (e: MouseEvent) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (editingNodeRef.current) return;
        const node = textNodeAt(e.clientX, e.clientY);
        const parent = node?.parentElement ?? null;
        if (parent === highlightedRef.current) return;
        clearHighlight();
        if (parent) {
          parent.setAttribute("data-copy-hover", "");
          highlightedRef.current = parent;
        }
      });
    };

    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
      clearHighlight();
    };
  }, [editing]);

  // ---------------------------------------------------------------------
  // Editing one phrase
  // ---------------------------------------------------------------------

  const commit = useCallback(
    async (span: HTMLElement, save: boolean) => {
      const original = span.dataset.copyOriginal ?? "";
      const lead = span.dataset.copyLead ?? "";
      const tail = span.dataset.copyTail ?? "";
      const next = (span.textContent ?? "").trim();

      if (
        save &&
        next !== "" &&
        next !== original &&
        NUMBER_ONLY.test(next)
      ) {
        setStatus("Live figures can be cleared, but not rewritten");
        window.setTimeout(() => setStatus(null), 2600);
        const restore = span.dataset.copyWas ?? original;
        span.replaceWith(document.createTextNode(`${lead}${restore}${tail}`));
        editingNodeRef.current = null;
        return;
      }

      const restore = save ? next : (span.dataset.copyWas ?? original);
      span.replaceWith(document.createTextNode(`${lead}${restore}${tail}`));
      editingNodeRef.current = null;

      if (!save || next === (span.dataset.copyWas ?? original)) return;

      setStatus("Saving");
      try {
        const res = await fetch("/api/copy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            original,
            // Empty string clears the rendered text; null restores the original.
            replacement: next === original ? null : next,
          }),
        });
        const json = (await res.json()) as { persisted?: boolean };
        setStatus(
          json.persisted === false
            ? "Saved, but this machine cannot keep it past the next deploy"
            : next === original
              ? "Restored the original wording"
              : next === ""
                ? "Cleared"
                : "Saved",
        );
        router.refresh();
      } catch {
        setStatus("Could not save that one");
      }
      window.setTimeout(() => setStatus(null), 2600);
    },
    [router],
  );

  useEffect(() => {
    if (!editing) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-copy-ui]")) return;

      // Already editing something: let clicks inside it place the caret.
      if (editingNodeRef.current?.contains(target)) return;
      if (editingNodeRef.current) {
        void commit(editingNodeRef.current, true);
        return;
      }

      const node = textNodeAt(e.clientX, e.clientY);
      if (!node) return;

      // Nothing should navigate or submit while the words are being changed.
      e.preventDefault();
      e.stopPropagation();

      const raw = node.nodeValue ?? "";
      const shown = raw.trim();
      const lead = raw.slice(0, raw.indexOf(shown[0]));
      const tail = raw.slice(raw.lastIndexOf(shown[shown.length - 1]) + 1);

      const span = document.createElement("span");
      span.setAttribute("data-copy-editing", "");
      span.setAttribute("contenteditable", "plaintext-only");
      span.dataset.copyOriginal = originalFor(shown);
      span.dataset.copyWas = shown;
      span.dataset.copyLead = lead;
      span.dataset.copyTail = tail;
      span.textContent = shown;

      clearHighlight();
      applyingRef.current = true;
      node.replaceWith(span);
      applyingRef.current = false;
      editingNodeRef.current = span;

      span.focus();
      const range = document.createRange();
      const first = span.firstChild;
      if (first) {
        range.setStart(first, Math.min(caretOffset, shown.length));
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const span = editingNodeRef.current;
      if (!span) {
        if (e.key === "Escape") setEditOn(false);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        void commit(span, false);
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void commit(span, true);
      }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [editing, commit, originalFor]);

  const count = Object.keys(overrides).length;

  return (
    <>
      <style>{`
        body[data-copy-edit="on"] [data-copy-hover] {
          outline: 1px dashed rgb(20 148 132 / 0.85);
          outline-offset: 2px;
          border-radius: 3px;
          cursor: text;
        }
        [data-copy-editing] {
          outline: 2px solid rgb(20 148 132);
          outline-offset: 2px;
          border-radius: 3px;
          background: rgb(20 148 132 / 0.07);
        }
      `}</style>

      <div
        data-copy-ui
        className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      >
        {status ? (
          <div className="rounded-lg bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
            {status}
          </div>
        ) : null}

        {editing ? (
          <div className="max-w-[280px] rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600 shadow-lg">
            Click any sentence to rewrite it.{" "}
            <span className="font-medium text-ink-800">Enter</span> saves,{" "}
            <span className="font-medium text-ink-800">Esc</span> cancels.
            Clear the box and save to remove wording; live figures can be
            cleared the same way, but not rewritten into a frozen number. Links
            and buttons stay clickable so you can keep moving around the site.
            {!persistable ? (
              <span className="mt-1.5 block text-amber-700">
                This machine cannot keep changes past the next deploy. Edit
                locally to make them permanent.
              </span>
            ) : null}
          </div>
        ) : null}

        <button
          onClick={() => setEditOn(!editing)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium shadow-lg transition ${
            editing
              ? "bg-glass-600 text-white hover:bg-glass-700"
              : "border border-ink-200 bg-white text-ink-600 hover:text-ink-900"
          }`}
          title={
            editing ? "Stop editing text" : "Edit the wording on this page"
          }
        >
          {editing ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Done editing
            </>
          ) : (
            <>
              <Pencil className="h-3.5 w-3.5" />
              Edit text
              {count > 0 ? (
                <span className="tnum rounded-full bg-ink-100 px-1.5 text-[10.5px] text-ink-600">
                  {count}
                </span>
              ) : null}
            </>
          )}
        </button>
      </div>
    </>
  );
}

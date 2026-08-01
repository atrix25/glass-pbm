/**
 * PDF text extraction with layout preservation.
 *
 * The Navitus formulary is a fixed-width table, so column position carries
 * meaning: the drug name, the special code, the level, and the category are
 * distinguished by where they sit on the line, not by any delimiter. Naive
 * text extraction collapses that and makes the file unparseable, so we
 * reconstruct lines from glyph coordinates.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

export interface ExtractedPage {
  pageNumber: number;
  lines: string[];
}

export async function extractPdfLines(
  data: Uint8Array,
  opts: { maxPages?: number; charWidth?: number } = {},
): Promise<ExtractedPage[]> {
  // pdfjs-dist ships as ESM with a legacy CJS build for Node.
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );

  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pageCount = opts.maxPages
    ? Math.min(opts.maxPages, doc.numPages)
    : doc.numPages;
  const charWidth = opts.charWidth ?? 4.6;
  const pages: ExtractedPage[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Bucket glyph runs by their y coordinate, rounded, to rebuild lines.
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const raw of content.items as TextItem[]) {
      if (!raw.str || !raw.str.trim()) continue;
      const x = raw.transform[4];
      const y = Math.round(raw.transform[5] * 2) / 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, str: raw.str });
    }

    const ys = [...rows.keys()].sort((a, b) => b - a); // top of page first
    const lines: string[] = [];

    for (const y of ys) {
      const runs = rows.get(y)!.sort((a, b) => a.x - b.x);
      let line = "";
      for (const run of runs) {
        const col = Math.round(run.x / charWidth);
        if (col > line.length) line += " ".repeat(col - line.length);
        line += run.str;
      }
      const trimmed = line.trimEnd();
      if (trimmed.trim()) lines.push(trimmed);
    }

    pages.push({ pageNumber: p, lines });
    page.cleanup();
  }

  await doc.destroy();
  return pages;
}

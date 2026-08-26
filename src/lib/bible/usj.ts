/**
 * Parser for USJ 3.0, the JSON serialization of USFM that the BSB ships in.
 *
 * Two things matter here beyond mechanical correctness.
 *
 * First, footnotes and cross-reference lines are editorial apparatus, not
 * Scripture. They are captured separately so they can be shown as helps but
 * can never be quoted back to a user as though they were the text itself.
 *
 * Second, the BSB carries the translators' own section headings. Those
 * headings are the natural unit of meaning — a pericope — and this parser
 * treats them as the boundary for retrieval. Indexing whole pericopes rather
 * than loose verses is what makes it structurally hard to hand someone a
 * fragment torn out of its argument.
 */

import { getBook, type Genre, type Testament } from "./canon.ts";

// ---------------------------------------------------------------------------
// USJ node shapes
// ---------------------------------------------------------------------------

interface UsjElement {
  type: string;
  marker?: string;
  code?: string;
  number?: string;
  sid?: string;
  loc?: string;
  content?: UsjNode[];
}

type UsjNode = string | UsjElement;

interface UsjDocument {
  type: string;
  version: string;
  content: UsjNode[];
}

// ---------------------------------------------------------------------------
// Parsed output
// ---------------------------------------------------------------------------

/**
 * A run of verse text carrying the paragraph marker it appeared under, so the
 * UI can reproduce poetic lineation instead of flattening Hebrew poetry into
 * prose. `wj` marks words spoken by Jesus.
 */
export interface VerseSegment {
  marker: string;
  text: string;
  wj?: boolean;
}

export interface Footnote {
  /** Caller-facing origin, e.g. "3:16". */
  ref: string;
  text: string;
}

export interface ParsedVerse {
  book: string;
  chapter: number;
  verse: number;
  /** Stable canonical sort key: book order * 1e6 + chapter * 1e3 + verse. */
  sortKey: number;
  /** Normalized single-line text, used for search, quoting, and verification. */
  text: string;
  segments: VerseSegment[];
  /** True when any part of the verse is marked as the words of Jesus. */
  redLetter: boolean;
  footnotes: Footnote[];
  /** Index of the owning pericope within the book. */
  pericopeIndex: number;
}

export interface ParsedPericope {
  book: string;
  /** Index within the book, in document order. */
  index: number;
  /** Translators' section heading, or null where a book opens without one. */
  heading: string | null;
  /** Enclosing major-section heading, e.g. "BOOK II" in the Psalms. */
  majorHeading: string | null;
  /** Parallel-passage references printed under the heading. */
  crossRefs: string[];
  startSortKey: number;
  endSortKey: number;
  verseCount: number;
}

export interface ParsedBook {
  code: string;
  name: string;
  order: number;
  testament: Testament;
  genre: Genre;
  chapters: number;
  verses: ParsedVerse[];
  pericopes: ParsedPericope[];
}

// ---------------------------------------------------------------------------
// Marker classification
// ---------------------------------------------------------------------------

/** Front matter and running heads: carry no Scripture text. */
const METADATA_MARKERS = new Set(["h", "toc1", "toc2", "toc3", "mt1", "mt2", "mt3", "id"]);

/** Section headings, which open a new pericope. */
const SECTION_MARKERS = new Set(["s1", "s2", "s3", "s4"]);

/** Major section headings, e.g. the five books of the Psalter. */
const MAJOR_SECTION_MARKERS = new Set(["ms", "ms1", "ms2"]);

/** Parallel-passage reference lines printed beneath a heading. */
const REFERENCE_MARKERS = new Set(["r", "sr"]);

/** Paragraph markers whose text belongs to the enclosing verse. */
const POETRY_MARKERS = new Set(["q1", "q2", "q3", "q4", "qr", "qc", "qa"]);

export function sortKeyFor(bookOrder: number, chapter: number, verse: number): number {
  return bookOrder * 1_000_000 + chapter * 1_000 + verse;
}

function isElement(node: UsjNode): node is UsjElement {
  return typeof node !== "string";
}

/**
 * Collects plain text from a subtree.
 *
 * Notes are always skipped. Cross-references are skipped in Scripture text —
 * where they are apparatus — but kept inside footnotes, whose prose often
 * reads "see Genesis 1:1" and becomes nonsense without them.
 */
function collectText(node: UsjNode, out: string[], keepRefs = false): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (node.type === "note") return;
  if (node.type === "ref" && !keepRefs) return;
  for (const child of node.content ?? []) collectText(child, out, keepRefs);
}

function textOf(node: UsjNode, keepRefs = false): string {
  const parts: string[] = [];
  collectText(node, parts, keepRefs);
  return parts.join("");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Extracts a footnote's body, dropping its leading origin reference. */
function parseFootnote(node: UsjElement): Footnote | null {
  let ref = "";
  const body: string[] = [];

  for (const child of node.content ?? []) {
    if (!isElement(child)) {
      body.push(child);
      continue;
    }
    if (child.marker === "fr") {
      ref = normalizeWhitespace(textOf(child, true));
    } else {
      body.push(textOf(child, true));
    }
  }

  const text = normalizeWhitespace(body.join(""));
  if (!text) return null;
  return { ref, text };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface VerseAccumulator {
  chapter: number;
  verse: number;
  segments: VerseSegment[];
  footnotes: Footnote[];
  redLetter: boolean;
  pericopeIndex: number;
}

interface PericopeAccumulator {
  heading: string | null;
  majorHeading: string | null;
  crossRefs: string[];
  index: number;
  verseCount: number;
  startSortKey: number;
  endSortKey: number;
}

export function parseUsj(raw: string, expectedCode?: string): ParsedBook {
  const doc = JSON.parse(raw) as UsjDocument;

  if (doc.type !== "USJ") {
    throw new Error(`Expected a USJ document, got type "${doc.type}"`);
  }

  const bookNode = doc.content.find(
    (n): n is UsjElement => isElement(n) && n.type === "book",
  );
  const code = (bookNode?.code ?? expectedCode ?? "").toUpperCase();
  const book = getBook(code);

  if (!book) {
    throw new Error(`Unknown book code "${code}" — not in the 66-book canon`);
  }

  const verses: ParsedVerse[] = [];
  const pericopes: PericopeAccumulator[] = [];

  let chapter = 0;
  let current: VerseAccumulator | null = null;
  let majorHeading: string | null = null;

  // Heading text arrives before the verses it governs, so a pericope is opened
  // lazily: the heading is held until a verse actually appears under it. The
  // open pericope is tracked by index rather than by reference so that reads
  // stay straightforward for both the reader and the type checker.
  let pendingHeading: string | null = null;
  let pendingCrossRefs: string[] = [];
  let pendingIsNew = false;
  let openIndex = -1;

  const openPericope = (): PericopeAccumulator | null =>
    openIndex >= 0 ? pericopes[openIndex] : null;

  function flushVerse(): void {
    if (!current) return;

    const segments = current.segments.filter((s) => s.text.length > 0);
    const text = normalizeWhitespace(segments.map((s) => s.text).join(" "));

    verses.push({
      book: book!.code,
      chapter: current.chapter,
      verse: current.verse,
      sortKey: sortKeyFor(book!.order, current.chapter, current.verse),
      text,
      segments,
      redLetter: current.redLetter,
      footnotes: current.footnotes,
      pericopeIndex: current.pericopeIndex,
    });

    current = null;
  }

  function openPericopeIfPending(): void {
    if (!pendingIsNew && openIndex >= 0) return;

    pericopes.push({
      heading: pendingHeading,
      majorHeading,
      crossRefs: pendingCrossRefs,
      index: pericopes.length,
      verseCount: 0,
      startSortKey: 0,
      endSortKey: 0,
    });
    openIndex = pericopes.length - 1;

    pendingHeading = null;
    pendingCrossRefs = [];
    pendingIsNew = false;
  }

  function startVerse(sid: string | undefined, number: string | undefined): void {
    flushVerse();
    openPericopeIfPending();

    const parsed = parseSid(sid, chapter, number);
    if (!parsed) return;

    const pericope = openPericope();
    if (!pericope) return;

    const key = sortKeyFor(book!.order, parsed.chapter, parsed.verse);
    pericope.verseCount += 1;
    if (pericope.startSortKey === 0) pericope.startSortKey = key;
    pericope.endSortKey = key;

    current = {
      chapter: parsed.chapter,
      verse: parsed.verse,
      segments: [],
      footnotes: [],
      redLetter: false,
      pericopeIndex: pericope.index,
    };
  }

  /** Walks a paragraph's inline content, attributing text to the open verse. */
  function walkInline(node: UsjNode, marker: string, inWj: boolean): void {
    if (typeof node === "string") {
      if (current && node.length > 0) {
        current.segments.push({
          marker,
          text: node,
          ...(inWj ? { wj: true } : {}),
        });
        if (inWj) current.redLetter = true;
      }
      return;
    }

    if (node.type === "verse") {
      startVerse(node.sid, node.number);
      return;
    }

    if (node.type === "note") {
      const note = parseFootnote(node);
      if (note && current) current.footnotes.push(note);
      return;
    }

    // Inline cross-references are apparatus; never part of the verse.
    if (node.type === "ref") return;

    const nowInWj = inWj || (node.type === "char" && node.marker === "wj");
    for (const child of node.content ?? []) {
      walkInline(child, marker, nowInWj);
    }
  }

  for (const node of doc.content) {
    if (!isElement(node)) continue;

    if (node.type === "book") continue;

    if (node.type === "chapter") {
      chapter = Number.parseInt(node.number ?? "0", 10);
      continue;
    }

    if (node.type !== "para") continue;

    const marker = node.marker ?? "p";

    if (METADATA_MARKERS.has(marker)) continue;

    if (MAJOR_SECTION_MARKERS.has(marker)) {
      flushVerse();
      majorHeading = normalizeWhitespace(textOf(node)) || null;
      continue;
    }

    if (SECTION_MARKERS.has(marker)) {
      flushVerse();
      pendingHeading = normalizeWhitespace(textOf(node)) || null;
      pendingCrossRefs = [];
      pendingIsNew = true;
      continue;
    }

    if (REFERENCE_MARKERS.has(marker)) {
      // Cross-reference line belonging to the heading just seen.
      const refs: string[] = [];
      const collect = (n: UsjNode): void => {
        if (typeof n === "string") return;
        if (n.type === "ref" && n.loc) refs.push(n.loc);
        for (const child of n.content ?? []) collect(child);
      };
      collect(node);
      const open = openPericope();
      if (pendingIsNew || !open) {
        pendingCrossRefs.push(...refs);
      } else {
        open.crossRefs.push(...refs);
      }
      continue;
    }

    // `b` is a stanza break with no text of its own.
    if (marker === "b") continue;

    for (const child of node.content ?? []) {
      walkInline(child, marker, false);
    }
  }

  flushVerse();

  const finished: ParsedPericope[] = pericopes
    .filter((p) => p.verseCount > 0)
    .map((p, i) => ({
      book: book.code,
      index: i,
      heading: p.heading,
      majorHeading: p.majorHeading,
      crossRefs: p.crossRefs,
      startSortKey: p.startSortKey,
      endSortKey: p.endSortKey,
      verseCount: p.verseCount,
    }));

  // Filtering empty pericopes can shift indices, so remap verses onto the
  // surviving set rather than leaving dangling references.
  const indexRemap = new Map<number, number>();
  let next = 0;
  for (const p of pericopes) {
    if (p.verseCount > 0) indexRemap.set(p.index, next++);
  }
  for (const verse of verses) {
    verse.pericopeIndex = indexRemap.get(verse.pericopeIndex) ?? 0;
  }

  return {
    code: book.code,
    name: book.name,
    order: book.order,
    testament: book.testament,
    genre: book.genre,
    chapters: chapter,
    verses,
    pericopes: finished,
  };
}

/** Reads "PSA 3:1" milestones, falling back to running chapter state. */
function parseSid(
  sid: string | undefined,
  fallbackChapter: number,
  number: string | undefined,
): { chapter: number; verse: number } | null {
  if (sid) {
    const match = /^([A-Z0-9]{3})\s+(\d+):(\d+)$/.exec(sid.trim());
    if (match) {
      return {
        chapter: Number.parseInt(match[2], 10),
        verse: Number.parseInt(match[3], 10),
      };
    }
  }

  const verse = Number.parseInt(number ?? "", 10);
  if (!Number.isFinite(verse) || fallbackChapter <= 0) return null;
  return { chapter: fallbackChapter, verse };
}

export { POETRY_MARKERS };

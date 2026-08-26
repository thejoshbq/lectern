/**
 * Parsing, normalizing, and formatting Scripture references.
 *
 * This module is the first gate in citation verification. A model is free to
 * emit any string it likes; if that string does not parse into a reference
 * that exists in the canon, with a chapter that exists in that book and a
 * verse that exists in that chapter, it never reaches the reader. Parsing is
 * therefore deliberately strict: it would rather reject a real citation that
 * was written oddly than accept an invented one.
 */

import {
  BOOKS,
  getBook,
  getBookByOrder,
  lookupBook,
  type Book,
} from "./canon.ts";
import { sortKeyFor } from "./usj.ts";

export interface VerseRef {
  book: string;
  chapter: number;
  verse: number;
}

/** An inclusive span of verses in canonical order. */
export interface RangeRef {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
}

export function verseSortKey(ref: VerseRef): number {
  const book = getBook(ref.book);
  if (!book) throw new Error(`Unknown book code: ${ref.book}`);
  return sortKeyFor(book.order, ref.chapter, ref.verse);
}

export function sortKeyToRef(key: number): VerseRef {
  const order = Math.floor(key / 1_000_000);
  const book = getBookByOrder(order);
  if (!book) throw new Error(`Sort key ${key} maps to no book`);
  const remainder = key % 1_000_000;
  return {
    book: book.code,
    chapter: Math.floor(remainder / 1_000),
    verse: remainder % 1_000,
  };
}

export function rangeStartKey(range: RangeRef): number {
  return verseSortKey({
    book: range.book,
    chapter: range.startChapter,
    verse: range.startVerse,
  });
}

export function rangeEndKey(range: RangeRef): number {
  return verseSortKey({
    book: range.book,
    chapter: range.endChapter,
    verse: range.endVerse,
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Matches a book name followed by an optional chapter/verse specification.
 *
 * The book portion allows a leading numeral ("1 Corinthians"), interior
 * spaces and periods ("Song of Sol."), but stops at the first digit that
 * begins the chapter, which is what the trailing lookahead enforces.
 */
const REFERENCE_PATTERN =
  /^\s*((?:[1-3]|i{1,3}|first|second|third)?\s*[A-Za-z][A-Za-z.'\u2019\s]*?)\s*(\d+)?\s*(?::\s*(\d+))?\s*(?:\s*[-\u2013\u2014]\s*(?:(\d+)\s*:\s*)?(\d+))?\s*$/i;

export interface ParseOptions {
  /**
   * When true, a bare book or book+chapter reference is accepted and expanded
   * to cover the whole unit. Off by default: an agent citing "Romans" as
   * support for a claim is exactly the imprecision this project rejects.
   */
  allowWhole?: boolean;
}

/**
 * Parses a single human-written reference such as "1 Cor 13:4-7".
 *
 * Returns null rather than throwing, because parse failure is an expected
 * outcome when validating model output, not an exceptional one.
 */
export function parseReference(
  input: string,
  options: ParseOptions = {},
): RangeRef | null {
  if (!input) return null;

  const match = REFERENCE_PATTERN.exec(input.trim());
  if (!match) return null;

  const [, bookPart, chapterPart, versePart, endChapterPart, endPart] = match;

  const book = lookupBook(bookPart);
  if (!book) return null;

  // "Philemon 6" means verse 6 of the single chapter, not chapter 6.
  const singleChapterBook = book.chapters === 1;

  if (chapterPart === undefined) {
    if (!options.allowWhole) return null;
    return wholeBook(book);
  }

  let startChapter: number;
  let startVerse: number | null;

  if (singleChapterBook && versePart === undefined) {
    startChapter = 1;
    startVerse = Number.parseInt(chapterPart, 10);
  } else {
    startChapter = Number.parseInt(chapterPart, 10);
    startVerse = versePart === undefined ? null : Number.parseInt(versePart, 10);
  }

  if (startChapter < 1 || startChapter > book.chapters) return null;

  if (startVerse === null) {
    if (!options.allowWhole) return null;
    const endChapter = endPart ? Number.parseInt(endPart, 10) : startChapter;
    if (endChapter < startChapter || endChapter > book.chapters) return null;
    return {
      book: book.code,
      startChapter,
      startVerse: 1,
      endChapter,
      endVerse: MAX_VERSE,
    };
  }

  if (startVerse < 1) return null;

  let endChapter = startChapter;
  let endVerse = startVerse;

  if (endPart !== undefined) {
    endVerse = Number.parseInt(endPart, 10);
    endChapter =
      endChapterPart !== undefined
        ? Number.parseInt(endChapterPart, 10)
        : startChapter;

    if (endChapter > book.chapters) return null;
    if (endChapter < startChapter) return null;
    if (endChapter === startChapter && endVerse < startVerse) return null;
  }

  return {
    book: book.code,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  };
}

/** Upper bound standing in for "through the end of the chapter". */
const MAX_VERSE = 999;

function wholeBook(book: Book): RangeRef {
  return {
    book: book.code,
    startChapter: 1,
    startVerse: 1,
    endChapter: book.chapters,
    endVerse: MAX_VERSE,
  };
}

/**
 * Extracts every reference found in free text.
 *
 * Used to audit prose for citations that bypassed the structured citation
 * channel — a model that slips "as Romans 8:28 says" into its commentary is
 * still making a claim about Scripture that has to be checked.
 */
export function extractReferences(text: string): RangeRef[] {
  const names = BOOKS.flatMap((b) => [b.name, ...b.aliases])
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");

  const pattern = new RegExp(
    `\\b((?:[1-3]|I{1,3})\\s*)?(${names})\\.?\\s*(\\d+)\\s*:\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*(?:(\\d+)\\s*:\\s*)?(\\d+))?`,
    "gi",
  );

  const found: RangeRef[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(pattern)) {
    const label = `${match[1] ?? ""}${match[2]}`;
    const rest = match[0].slice(label.length);
    const parsed = parseReference(`${label} ${rest}`.replace(/\s+/g, " "));
    if (!parsed) continue;
    const key = formatRange(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(parsed);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatVerse(ref: VerseRef): string {
  const book = getBook(ref.book);
  const name = book?.name ?? ref.book;
  if (book?.chapters === 1) return `${name} ${ref.verse}`;
  return `${name} ${ref.chapter}:${ref.verse}`;
}

/** Renders a range the way a citation would be printed: "1 John 4:7-12". */
export function formatRange(range: RangeRef): string {
  const book = getBook(range.book);
  const name = book?.name ?? range.book;

  if (book?.chapters === 1) {
    return range.startVerse === range.endVerse
      ? `${name} ${range.startVerse}`
      : `${name} ${range.startVerse}-${range.endVerse}`;
  }

  if (range.startChapter === range.endChapter) {
    if (range.startVerse === range.endVerse) {
      return `${name} ${range.startChapter}:${range.startVerse}`;
    }
    return `${name} ${range.startChapter}:${range.startVerse}-${range.endVerse}`;
  }

  return `${name} ${range.startChapter}:${range.startVerse}-${range.endChapter}:${range.endVerse}`;
}

/** True when the two ranges share at least one verse. */
export function rangesOverlap(a: RangeRef, b: RangeRef): boolean {
  if (a.book !== b.book) return false;
  return rangeStartKey(a) <= rangeEndKey(b) && rangeStartKey(b) <= rangeEndKey(a);
}

/** True when `inner` lies entirely within `outer`. */
export function rangeContains(outer: RangeRef, inner: RangeRef): boolean {
  if (outer.book !== inner.book) return false;
  return (
    rangeStartKey(outer) <= rangeStartKey(inner) &&
    rangeEndKey(inner) <= rangeEndKey(outer)
  );
}

export function rangeVerseCount(range: RangeRef): number {
  return rangeEndKey(range) - rangeStartKey(range) + 1;
}

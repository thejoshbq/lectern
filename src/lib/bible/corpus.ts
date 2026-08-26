/**
 * Read-only access to the Bible corpus.
 *
 * This is the only module that reads Scripture text, and it is the module the
 * verification layer relies on: if a reference cannot be resolved here, it does
 * not exist, and nothing downstream may present it as though it does.
 *
 * The database is opened read-only and cached for the process lifetime. The
 * text of Scripture is not application state and is never written at runtime.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

import type { Genre, Testament } from "./canon.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import type { RangeRef, VerseRef } from "./reference.ts";
import { rangeEndKey, rangeStartKey, verseSortKey } from "./reference.ts";
import { CORPUS_DB } from "../paths.ts";

export interface VerseSegment {
  marker: string;
  text: string;
  wj?: boolean;
}

export interface Footnote {
  ref: string;
  text: string;
}

export interface Verse {
  sortKey: number;
  book: string;
  chapter: number;
  verse: number;
  ref: string;
  text: string;
  segments: VerseSegment[];
  footnotes: Footnote[];
  redLetter: boolean;
  passageId: number;
}

export interface Passage {
  id: number;
  book: string;
  heading: string | null;
  majorHeading: string | null;
  crossRefs: string[];
  ref: string;
  text: string;
  startKey: number;
  endKey: number;
  verseCount: number;
  testament: Testament;
  genre: Genre;
}

export interface PassageWithVerses extends Passage {
  verses: Verse[];
}

export interface CorpusInfo {
  translation: string;
  translationName: string;
  license: string;
  release: string;
  verseCount: number;
  passageCount: number;
  embeddingModel: string | null;
  embeddingDim: number | null;
  hasVectors: boolean;
}

let db: DatabaseSync | null = null;

export function openCorpus(): DatabaseSync {
  if (db) return db;

  if (!existsSync(CORPUS_DB)) {
    throw new Error(
      `No Bible corpus at ${CORPUS_DB}.\n` +
        `Build it with:  npm run bible:fetch && npm run bible:build`,
    );
  }

  const handle = new DatabaseSync(CORPUS_DB, { readOnly: true });

  const version = (
    handle.prepare("select value from meta where key = 'schemaVersion'").get() as
      | { value: string }
      | undefined
  )?.value;

  if (Number(version) !== SCHEMA_VERSION) {
    handle.close();
    throw new Error(
      `Corpus is schema v${version ?? "unknown"} but this code expects ` +
        `v${SCHEMA_VERSION}. Rebuild with \`npm run bible:build\`.`,
    );
  }

  db = handle;
  return db;
}

export function closeCorpus(): void {
  db?.close();
  db = null;
}

/**
 * Typed query helpers.
 *
 * `node:sqlite` returns untyped row records. Rather than casting at every call
 * site, the two helpers below centralize it, and every caller declares the row
 * shape it expects.
 */
export function queryAll<T>(sql: string, ...params: unknown[]): T[] {
  return openCorpus()
    .prepare(sql)
    .all(...(params as never[])) as unknown as T[];
}

export function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  return openCorpus()
    .prepare(sql)
    .get(...(params as never[])) as unknown as T | undefined;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface RawVerse {
  sort_key: number;
  book: string;
  chapter: number;
  verse: number;
  ref: string;
  text: string;
  segments: string;
  footnotes: string;
  red_letter: number;
  passage_id: number;
}

interface RawPassage {
  id: number;
  book: string;
  heading: string | null;
  major_heading: string | null;
  cross_refs: string;
  ref: string;
  text: string;
  start_key: number;
  end_key: number;
  verse_count: number;
  testament: string;
  genre: string;
}

function toVerse(row: RawVerse): Verse {
  return {
    sortKey: row.sort_key,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    ref: row.ref,
    text: row.text,
    segments: JSON.parse(row.segments) as VerseSegment[],
    footnotes: JSON.parse(row.footnotes) as Footnote[],
    redLetter: row.red_letter === 1,
    passageId: row.passage_id,
  };
}

function toPassage(row: RawPassage): Passage {
  return {
    id: row.id,
    book: row.book,
    heading: row.heading,
    majorHeading: row.major_heading,
    crossRefs: JSON.parse(row.cross_refs) as string[],
    ref: row.ref,
    text: row.text,
    startKey: row.start_key,
    endKey: row.end_key,
    verseCount: row.verse_count,
    testament: row.testament as Testament,
    genre: row.genre as Genre,
  };
}

const VERSE_COLUMNS =
  "sort_key, book, chapter, verse, ref, text, segments, footnotes, red_letter, passage_id";
const PASSAGE_COLUMNS =
  "id, book, heading, major_heading, cross_refs, ref, text, start_key, end_key, verse_count, testament, genre";

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getCorpusInfo(): CorpusInfo {
  const rows = queryAll<{ key: string; value: string }>(
    "select key, value from meta",
  );
  const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const vectorCount =
    queryOne<{ n: number }>("select count(*) n from chunk_vectors")?.n ?? 0;

  return {
    translation: meta.translation ?? "BSB",
    translationName: meta.translationName ?? "Berean Standard Bible",
    license: meta.license ?? "",
    release: meta.release ?? "unknown",
    verseCount: Number(meta.verseCount ?? 0),
    passageCount: Number(meta.passageCount ?? 0),
    embeddingModel: meta.embeddingModel ?? null,
    embeddingDim: meta.embeddingDim ? Number(meta.embeddingDim) : null,
    hasVectors: vectorCount > 0,
  };
}

export function getVerse(ref: VerseRef): Verse | null {
  const row = queryOne<RawVerse>(
    `select ${VERSE_COLUMNS} from verses where sort_key = ?`,
    verseSortKey(ref),
  );
  return row ? toVerse(row) : null;
}

/** Every verse in a range, in canonical order. Empty when none resolve. */
export function getVersesInRange(range: RangeRef): Verse[] {
  return queryAll<RawVerse>(
    `select ${VERSE_COLUMNS} from verses
      where sort_key between ? and ? and book = ?
      order by sort_key`,
    rangeStartKey(range),
    rangeEndKey(range),
    range.book,
  ).map(toVerse);
}

export function getPassage(id: number): Passage | null {
  const row = queryOne<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages where id = ?`,
    id,
  );
  return row ? toPassage(row) : null;
}

export function getPassages(ids: number[]): Passage[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryAll<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages where id in (${placeholders})`,
    ...ids,
  );

  const byId = new Map(rows.map((r) => [r.id, toPassage(r)]));
  return ids.map((id) => byId.get(id)).filter((p): p is Passage => p !== undefined);
}

export function getPassageVerses(passageId: number): Verse[] {
  return queryAll<RawVerse>(
    `select ${VERSE_COLUMNS} from verses where passage_id = ? order by sort_key`,
    passageId,
  ).map(toVerse);
}

export function getPassageWithVerses(id: number): PassageWithVerses | null {
  const passage = getPassage(id);
  if (!passage) return null;
  return { ...passage, verses: getPassageVerses(id) };
}

/**
 * The passage containing a reference.
 *
 * This is how a citation gets its context: given "Romans 8:28", it returns the
 * whole section that verse belongs to, so the argument it sits inside can be
 * shown alongside it.
 */
export function findPassageContaining(ref: VerseRef): Passage | null {
  const key = verseSortKey(ref);
  const row = queryOne<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages
      where book = ? and start_key <= ? and end_key >= ?
      limit 1`,
    ref.book,
    key,
    key,
  );
  return row ? toPassage(row) : null;
}

/** Every passage a range touches, in canonical order. */
export function findPassagesOverlapping(range: RangeRef): Passage[] {
  return queryAll<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages
      where book = ? and start_key <= ? and end_key >= ?
      order by start_key`,
    range.book,
    rangeEndKey(range),
    rangeStartKey(range),
  ).map(toPassage);
}

/**
 * Neighbouring passages, for showing what comes immediately before and after.
 */
export function getAdjacentPassages(passage: Passage): {
  previous: Passage | null;
  next: Passage | null;
} {
  const previous = queryOne<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages
      where end_key < ? order by end_key desc limit 1`,
    passage.startKey,
  );

  const next = queryOne<RawPassage>(
    `select ${PASSAGE_COLUMNS} from passages
      where start_key > ? order by start_key limit 1`,
    passage.endKey,
  );

  return {
    previous: previous ? toPassage(previous) : null,
    next: next ? toPassage(next) : null,
  };
}

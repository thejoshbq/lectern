/**
 * Builds data/bsb.sqlite from the extracted USJ sources.
 *
 * Run after `npm run bible:fetch`. The output is a self-contained, read-only
 * corpus: every verse, the translators' pericope divisions, a lexical index at
 * both verse and passage level, and the chunk table that embeddings attach to.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { BOOKS, CHAPTER_COUNT } from "../src/lib/bible/canon.ts";
import { formatRange, formatVerse } from "../src/lib/bible/reference.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "../src/lib/bible/schema.ts";
import { parseUsj, type ParsedBook } from "../src/lib/bible/usj.ts";
import { CORPUS_DB, DATA_DIR, USJ_DIR, VENDOR_MANIFEST } from "../src/lib/paths.ts";

/**
 * Chunking limits for embedding units.
 *
 * Most pericopes fit in one chunk. The cap exists for outliers like Psalm 119
 * (176 verses), where a single vector over the whole thing would represent
 * nothing in particular. Overlap keeps an argument from being severed exactly
 * at a boundary.
 */
const CHUNK_MAX_VERSES = 24;
const CHUNK_MAX_WORDS = 380;
const CHUNK_OVERLAP_VERSES = 2;

interface VendorManifest {
  release: string;
  sha256: string;
}

function loadBooks(): ParsedBook[] {
  if (!existsSync(USJ_DIR)) {
    throw new Error(
      `No USJ sources at ${USJ_DIR}. Run \`npm run bible:fetch\` first.`,
    );
  }

  const books: ParsedBook[] = [];

  // Iterate the canon rather than the directory so that ordering is canonical
  // and a missing book is an error instead of a silent omission.
  for (const book of BOOKS) {
    const path = join(USJ_DIR, `${book.code}.usj`);
    if (!existsSync(path)) {
      throw new Error(`Missing source for ${book.name} (${book.code}) at ${path}`);
    }
    books.push(parseUsj(readFileSync(path, "utf8"), book.code));
  }

  return books;
}

interface Chunk {
  ord: number;
  ref: string;
  text: string;
  startKey: number;
  endKey: number;
}

/**
 * Splits a pericope into embedding units, prefixing each with the heading so
 * that the section's own framing informs the vector.
 */
function chunkPassage(
  heading: string | null,
  bookCode: string,
  verses: { chapter: number; verse: number; text: string; sortKey: number }[],
): Chunk[] {
  const label = heading ? `${heading}. ` : "";

  const fits =
    verses.length <= CHUNK_MAX_VERSES &&
    verses.reduce((n, v) => n + v.text.split(/\s+/).length, 0) <= CHUNK_MAX_WORDS;

  if (fits) {
    return [
      {
        ord: 0,
        ref: rangeRefOf(bookCode, verses),
        text: label + verses.map((v) => v.text).join(" "),
        startKey: verses[0].sortKey,
        endKey: verses[verses.length - 1].sortKey,
      },
    ];
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < verses.length) {
    let end = start;
    let words = 0;

    while (
      end < verses.length &&
      end - start < CHUNK_MAX_VERSES &&
      words < CHUNK_MAX_WORDS
    ) {
      words += verses[end].text.split(/\s+/).length;
      end++;
    }

    const slice = verses.slice(start, end);
    chunks.push({
      ord: chunks.length,
      ref: rangeRefOf(bookCode, slice),
      text: label + slice.map((v) => v.text).join(" "),
      startKey: slice[0].sortKey,
      endKey: slice[slice.length - 1].sortKey,
    });

    if (end >= verses.length) break;
    start = Math.max(end - CHUNK_OVERLAP_VERSES, start + 1);
  }

  return chunks;
}

function rangeRefOf(
  bookCode: string,
  verses: { chapter: number; verse: number }[],
): string {
  const first = verses[0];
  const last = verses[verses.length - 1];
  return formatRange({
    book: bookCode,
    startChapter: first.chapter,
    startVerse: first.verse,
    endChapter: last.chapter,
    endVerse: last.verse,
  });
}

function main() {
  console.log("Parsing USJ sources ...");
  const books = loadBooks();

  const verseTotal = books.reduce((n, b) => n + b.verses.length, 0);
  const passageTotal = books.reduce((n, b) => n + b.pericopes.length, 0);
  console.log(
    `Parsed ${books.length} books, ${verseTotal} verses, ${passageTotal} pericopes`,
  );

  mkdirSync(DATA_DIR, { recursive: true });
  rmSync(CORPUS_DB, { force: true });

  const db = new DatabaseSync(CORPUS_DB);
  db.exec("pragma journal_mode = wal");
  db.exec(SCHEMA_SQL);

  const insertBook = db.prepare(
    `insert into books (code, name, ord, testament, genre, chapters, verse_count)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPassage = db.prepare(
    `insert into passages
       (id, book, idx, heading, major_heading, cross_refs, ref, text,
        start_key, end_key, verse_count, testament, genre)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertVerse = db.prepare(
    `insert into verses
       (sort_key, book, chapter, verse, ref, text, segments, footnotes,
        red_letter, passage_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChunk = db.prepare(
    `insert into chunks (id, passage_id, ord, ref, text, start_key, end_key)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );

  let passageId = 0;
  let chunkId = 0;
  let chunkTotal = 0;
  let largestPassage = 0;

  db.exec("begin");

  for (const book of books) {
    insertBook.run(
      book.code,
      book.name,
      book.order,
      book.testament,
      book.genre,
      book.chapters,
      book.verses.length,
    );

    const versesByPericope = new Map<number, typeof book.verses>();
    for (const verse of book.verses) {
      const bucket = versesByPericope.get(verse.pericopeIndex);
      if (bucket) bucket.push(verse);
      else versesByPericope.set(verse.pericopeIndex, [verse]);
    }

    for (const pericope of book.pericopes) {
      const verses = versesByPericope.get(pericope.index) ?? [];
      if (verses.length === 0) {
        throw new Error(
          `Pericope ${book.code}#${pericope.index} has no verses; refusing to build`,
        );
      }

      passageId++;
      const text = verses.map((v) => v.text).join(" ");
      const ref = rangeRefOf(book.code, verses);

      insertPassage.run(
        passageId,
        book.code,
        pericope.index,
        pericope.heading,
        pericope.majorHeading,
        JSON.stringify(pericope.crossRefs),
        ref,
        text,
        pericope.startSortKey,
        pericope.endSortKey,
        verses.length,
        book.testament,
        book.genre,
      );

      largestPassage = Math.max(largestPassage, verses.length);

      for (const verse of verses) {
        insertVerse.run(
          verse.sortKey,
          verse.book,
          verse.chapter,
          verse.verse,
          formatVerse(verse),
          verse.text,
          JSON.stringify(verse.segments),
          JSON.stringify(verse.footnotes),
          verse.redLetter ? 1 : 0,
          passageId,
        );
      }

      for (const chunk of chunkPassage(pericope.heading, book.code, verses)) {
        chunkId++;
        chunkTotal++;
        insertChunk.run(
          chunkId,
          passageId,
          chunk.ord,
          chunk.ref,
          chunk.text,
          chunk.startKey,
          chunk.endKey,
        );
      }
    }
  }

  db.exec("commit");

  console.log("Building lexical indexes ...");
  db.exec("insert into verses_fts(verses_fts) values('rebuild')");
  db.exec("insert into passages_fts(passages_fts) values('rebuild')");

  const manifest: VendorManifest | null = existsSync(VENDOR_MANIFEST)
    ? (JSON.parse(readFileSync(VENDOR_MANIFEST, "utf8")) as VendorManifest)
    : null;

  const meta: Record<string, string> = {
    translation: "BSB",
    translationName: "Berean Standard Bible",
    license: "Public domain (CC0 1.0, 30 April 2023)",
    sourceRepo: "https://github.com/BSB-publishing/bsb2usfm",
    release: manifest?.release ?? "unknown",
    sourceSha256: manifest?.sha256 ?? "unknown",
    schemaVersion: String(SCHEMA_VERSION),
    builtAt: new Date().toISOString(),
    bookCount: String(books.length),
    chapterCount: String(CHAPTER_COUNT),
    verseCount: String(verseTotal),
    passageCount: String(passageId),
    chunkCount: String(chunkTotal),
  };

  const insertMeta = db.prepare("insert into meta (key, value) values (?, ?)");
  db.exec("begin");
  for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value);
  db.exec("commit");

  db.exec("pragma wal_checkpoint(truncate)");
  db.exec("vacuum");
  db.exec("pragma optimize");
  db.close();

  console.log(
    `\nWrote ${CORPUS_DB}\n` +
      `  books      ${books.length}\n` +
      `  verses     ${verseTotal}\n` +
      `  passages   ${passageId} (largest ${largestPassage} verses)\n` +
      `  chunks     ${chunkTotal}\n` +
      `  release    ${meta.release}\n\n` +
      `Next: npm run bible:verify`,
  );
}

try {
  main();
} catch (err) {
  console.error(`\nbuild-corpus failed: ${(err as Error).message}`);
  process.exit(1);
}

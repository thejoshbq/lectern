/**
 * Integrity checks for the generated corpus.
 *
 * A corrupt corpus is the worst failure this project can have, because it is
 * silent: retrieval still returns passages, the model still writes a warm
 * response, and the user is quietly handed text that is not what Scripture
 * says. Every structural assumption the rest of the system relies on is
 * therefore asserted here, and this runs in CI.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

import { BOOKS, BOOK_COUNT, CHAPTER_COUNT } from "../src/lib/bible/canon.ts";
import {
  isOmittedVerse,
  OMITTED_COUNT,
  OMITTED_VERSES,
} from "../src/lib/bible/omissions.ts";
import { formatVerse, parseReference } from "../src/lib/bible/reference.ts";
import { SCHEMA_VERSION } from "../src/lib/bible/schema.ts";
import { CORPUS_DB } from "../src/lib/paths.ts";

interface Check {
  name: string;
  run: (db: DatabaseSync) => string[];
}

const checks: Check[] = [
  {
    name: "schema version matches",
    run: (db) => {
      const row = db.prepare("select value from meta where key='schemaVersion'").get() as
        | { value: string }
        | undefined;
      if (!row) return ["meta.schemaVersion is missing"];
      return Number(row.value) === SCHEMA_VERSION
        ? []
        : [`corpus is schema v${row.value}, code expects v${SCHEMA_VERSION}; rebuild it`];
    },
  },

  {
    name: "66 books, canonical order and naming",
    run: (db) => {
      const rows = db
        .prepare("select code, name, ord, chapters from books order by ord")
        .all() as { code: string; name: string; ord: number; chapters: number }[];

      const errors: string[] = [];
      if (rows.length !== BOOK_COUNT) {
        errors.push(`expected ${BOOK_COUNT} books, found ${rows.length}`);
      }

      for (const [i, expected] of BOOKS.entries()) {
        const actual = rows[i];
        if (!actual) {
          errors.push(`missing book at position ${i + 1}: ${expected.name}`);
          continue;
        }
        if (actual.code !== expected.code) {
          errors.push(
            `position ${i + 1}: expected ${expected.code}, found ${actual.code}`,
          );
        }
        if (actual.chapters !== expected.chapters) {
          errors.push(
            `${expected.code}: expected ${expected.chapters} chapters, found ${actual.chapters}`,
          );
        }
      }

      return errors;
    },
  },

  {
    name: "1189 chapters, none missing or duplicated",
    run: (db) => {
      const errors: string[] = [];

      const total = db
        .prepare("select count(distinct book || ':' || chapter) n from verses")
        .get() as { n: number };

      if (total.n !== CHAPTER_COUNT) {
        errors.push(`expected ${CHAPTER_COUNT} chapters, found ${total.n}`);
      }

      // Each book's chapters must run 1..N with no gaps.
      for (const book of BOOKS) {
        const rows = db
          .prepare(
            "select distinct chapter from verses where book = ? order by chapter",
          )
          .all(book.code) as { chapter: number }[];

        if (rows.length !== book.chapters) {
          errors.push(
            `${book.code}: expected ${book.chapters} chapters, found ${rows.length}`,
          );
          continue;
        }
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].chapter !== i + 1) {
            errors.push(
              `${book.code}: chapter sequence breaks at ${rows[i].chapter} (expected ${i + 1})`,
            );
            break;
          }
        }
      }

      return errors;
    },
  },

  {
    name: "verse numbering is gapless apart from the known textual omissions",
    run: (db) => {
      const errors: string[] = [];
      const rows = db
        .prepare("select book, chapter, verse from verses order by sort_key")
        .all() as { book: string; chapter: number; verse: number }[];

      const byChapter = new Map<string, Set<number>>();
      for (const row of rows) {
        const key = `${row.book} ${row.chapter}`;
        const bucket = byChapter.get(key);
        if (bucket) bucket.add(row.verse);
        else byChapter.set(key, new Set([row.verse]));
      }

      // Any number absent below a chapter's maximum must be one of the sixteen
      // verses the BSB omits on manuscript grounds. Anything else is a
      // genuinely truncated build.
      const found = new Set<string>();

      for (const [chapterKey, present] of byChapter) {
        const [book, chapterText] = chapterKey.split(" ");
        const chapter = Number(chapterText);
        const highest = Math.max(...present);

        for (let verse = 1; verse <= highest; verse++) {
          if (present.has(verse)) continue;
          const ref = `${book} ${chapter}:${verse}`;
          if (isOmittedVerse(book, chapter, verse)) {
            found.add(ref);
          } else {
            errors.push(`${ref} is missing and is not a known textual omission`);
          }
        }
      }

      // The converse also has to hold: a corpus that quietly gained one of
      // these verses would mean the source text changed underneath us.
      for (const ref of Object.keys(OMITTED_VERSES)) {
        if (!found.has(ref)) {
          errors.push(`${ref} was expected to be absent but is present`);
        }
      }

      if (found.size !== OMITTED_COUNT && errors.length === 0) {
        errors.push(
          `expected ${OMITTED_COUNT} omitted verses, accounted for ${found.size}`,
        );
      }

      return errors;
    },
  },

  {
    name: "no verse is empty",
    run: (db) => {
      const rows = db
        .prepare("select ref from verses where trim(text) = '' limit 10")
        .all() as { ref: string }[];
      return rows.map((r) => `${r.ref} has empty text`);
    },
  },

  {
    name: "every verse belongs to exactly one existing passage",
    run: (db) => {
      const errors: string[] = [];

      const orphans = db
        .prepare(
          `select v.ref from verses v
             left join passages p on p.id = v.passage_id
            where p.id is null limit 10`,
        )
        .all() as { ref: string }[];
      errors.push(...orphans.map((r) => `${r.ref} references a missing passage`));

      const versesInPassages = db
        .prepare("select sum(verse_count) n from passages")
        .get() as { n: number };
      const verseTotal = db.prepare("select count(*) n from verses").get() as {
        n: number;
      };

      if (versesInPassages.n !== verseTotal.n) {
        errors.push(
          `passages claim ${versesInPassages.n} verses but the corpus has ${verseTotal.n}`,
        );
      }

      return errors;
    },
  },

  {
    name: "every passage covers a contiguous run of verses",
    run: (db) => {
      const errors: string[] = [];

      // Walking the whole canon in order, the passage id may only change at a
      // boundary and must never revisit a passage it has already left. That is
      // exactly the property "no pericope is interleaved with another".
      const rows = db
        .prepare("select sort_key, ref, passage_id from verses order by sort_key")
        .all() as { sort_key: number; ref: string; passage_id: number }[];

      const seen = new Set<number>();
      let previous = -1;

      for (const row of rows) {
        if (row.passage_id === previous) continue;
        if (seen.has(row.passage_id)) {
          errors.push(
            `passage ${row.passage_id} resumes at ${row.ref} after another passage intervened`,
          );
          if (errors.length > 10) break;
        }
        seen.add(row.passage_id);
        previous = row.passage_id;
      }

      // Declared bounds must match the verses actually present.
      const mismatches = db
        .prepare(
          `select p.id, p.ref, p.start_key, p.end_key, p.verse_count,
                  min(v.sort_key) lo, max(v.sort_key) hi, count(v.sort_key) n
             from passages p join verses v on v.passage_id = p.id
            group by p.id
           having p.start_key <> lo or p.end_key <> hi or p.verse_count <> n
            limit 10`,
        )
        .all() as { ref: string }[];
      errors.push(
        ...mismatches.map((r) => `${r.ref}: declared bounds disagree with its verses`),
      );

      return errors;
    },
  },

  {
    name: "every verse reference round-trips through the parser",
    run: (db) => {
      const errors: string[] = [];
      const rows = db
        .prepare("select book, chapter, verse, ref from verses")
        .all() as { book: string; chapter: number; verse: number; ref: string }[];

      for (const row of rows) {
        // The stored label must be exactly what the formatter produces, and
        // must parse back to the same verse. Verification depends on both.
        const expected = formatVerse(row);
        if (row.ref !== expected) {
          errors.push(`stored ref "${row.ref}" should be "${expected}"`);
        } else {
          const parsed = parseReference(row.ref);
          if (
            !parsed ||
            parsed.book !== row.book ||
            parsed.startChapter !== row.chapter ||
            parsed.startVerse !== row.verse
          ) {
            errors.push(`ref "${row.ref}" does not parse back to itself`);
          }
        }
        if (errors.length > 10) break;
      }

      return errors;
    },
  },

  {
    name: "chunks tile their passages without losing verses",
    run: (db) => {
      const errors: string[] = [];

      const orphans = db
        .prepare(
          `select c.id from chunks c left join passages p on p.id = c.passage_id
            where p.id is null limit 5`,
        )
        .all() as { id: number }[];
      errors.push(...orphans.map((r) => `chunk ${r.id} references a missing passage`));

      const uncovered = db
        .prepare(
          `select p.ref from passages p
            where not exists (select 1 from chunks c where c.passage_id = p.id)
            limit 5`,
        )
        .all() as { ref: string }[];
      errors.push(...uncovered.map((r) => `${r.ref} has no chunk`));

      const outOfBounds = db
        .prepare(
          `select c.ref from chunks c join passages p on p.id = c.passage_id
            where c.start_key < p.start_key or c.end_key > p.end_key limit 5`,
        )
        .all() as { ref: string }[];
      errors.push(
        ...outOfBounds.map((r) => `chunk ${r.ref} extends outside its passage`),
      );

      // The first and last verse of every passage must appear in some chunk,
      // otherwise a long passage could lose its opening or closing argument.
      const edges = db
        .prepare(
          `select p.ref from passages p
            where not exists (select 1 from chunks c
                               where c.passage_id = p.id and c.start_key = p.start_key)
               or not exists (select 1 from chunks c
                               where c.passage_id = p.id and c.end_key = p.end_key)
            limit 5`,
        )
        .all() as { ref: string }[];
      errors.push(...edges.map((r) => `${r.ref}: chunks omit its first or last verse`));

      return errors;
    },
  },

  {
    name: "lexical indexes cover every row",
    run: (db) => {
      const errors: string[] = [];

      const verses = db.prepare("select count(*) n from verses").get() as { n: number };
      const versesFts = db.prepare("select count(*) n from verses_fts").get() as {
        n: number;
      };
      if (verses.n !== versesFts.n) {
        errors.push(`verses_fts has ${versesFts.n} rows, verses has ${verses.n}`);
      }

      const passages = db.prepare("select count(*) n from passages").get() as {
        n: number;
      };
      const passagesFts = db.prepare("select count(*) n from passages_fts").get() as {
        n: number;
      };
      if (passages.n !== passagesFts.n) {
        errors.push(
          `passages_fts has ${passagesFts.n} rows, passages has ${passages.n}`,
        );
      }

      // A known verse must be findable, or the index is present but useless.
      const hit = db
        .prepare(
          `select v.ref from verses_fts join verses v on v.sort_key = verses_fts.rowid
            where verses_fts match 'shepherd' and v.ref = 'Psalms 23:1'`,
        )
        .get();
      if (!hit) errors.push("verses_fts cannot find 'shepherd' in Psalms 23:1");

      return errors;
    },
  },

  {
    name: "embeddings, if present, are complete and consistent",
    run: (db) => {
      const errors: string[] = [];
      const vectors = db.prepare("select count(*) n from chunk_vectors").get() as {
        n: number;
      };

      if (vectors.n === 0) return []; // Lexical-only is a supported mode.

      const chunks = db.prepare("select count(*) n from chunks").get() as { n: number };
      if (vectors.n !== chunks.n) {
        errors.push(
          `${vectors.n} vectors for ${chunks.n} chunks; run \`npm run bible:embed\``,
        );
      }

      const dims = db
        .prepare("select distinct dim from chunk_vectors")
        .all() as { dim: number }[];
      if (dims.length > 1) {
        errors.push(`mixed vector dimensions: ${dims.map((d) => d.dim).join(", ")}`);
      }

      const badLength = db
        .prepare("select count(*) n from chunk_vectors where length(vec) <> dim * 4")
        .get() as { n: number };
      if (badLength.n > 0) {
        errors.push(`${badLength.n} vectors have a byte length inconsistent with dim`);
      }

      return errors;
    },
  },
];

function main() {
  if (!existsSync(CORPUS_DB)) {
    console.error(
      `No corpus at ${CORPUS_DB}.\nRun \`npm run bible:fetch && npm run bible:build\` first.`,
    );
    process.exit(1);
  }

  const db = new DatabaseSync(CORPUS_DB, { readOnly: true });
  let failed = 0;

  for (const check of checks) {
    let errors: string[];
    try {
      errors = check.run(db);
    } catch (err) {
      errors = [`check threw: ${(err as Error).message}`];
    }

    if (errors.length === 0) {
      console.log(`  ok    ${check.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${check.name}`);
      for (const error of errors.slice(0, 10)) console.log(`          ${error}`);
      if (errors.length > 10) {
        console.log(`          ... and ${errors.length - 10} more`);
      }
    }
  }

  const stats = db.prepare("select key, value from meta").all() as {
    key: string;
    value: string;
  }[];
  const meta = Object.fromEntries(stats.map((s) => [s.key, s.value]));
  db.close();

  console.log("");
  if (failed > 0) {
    console.error(`${failed} of ${checks.length} checks failed.`);
    process.exit(1);
  }

  console.log(
    `All ${checks.length} checks passed. ` +
      `${meta.translation} ${meta.release}: ${meta.verseCount} verses in ${meta.passageCount} passages.`,
  );
}

main();

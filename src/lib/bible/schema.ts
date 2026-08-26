/**
 * Schema for the generated Bible corpus.
 *
 * The corpus is written once by `npm run bible:build` and thereafter opened
 * read-only. Nothing at request time may modify it: the text of Scripture is
 * not application state.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- Build provenance: translation, upstream release, schema version, and the
-- embedding model used, so a stale or mismatched corpus can be detected
-- rather than silently serving wrong results.
create table meta (
  key   text primary key,
  value text not null
) strict;

create table books (
  code        text primary key,
  name        text not null,
  ord         integer not null unique,
  testament   text not null,
  genre       text not null,
  chapters    integer not null,
  verse_count integer not null
) strict;

create table passages (
  id            integer primary key,
  book          text not null references books(code),
  idx           integer not null,
  heading       text,
  major_heading text,
  cross_refs    text not null,
  ref           text not null,
  text          text not null,
  start_key     integer not null,
  end_key       integer not null,
  verse_count   integer not null,
  testament     text not null,
  genre         text not null,
  unique (book, idx)
) strict;

create table verses (
  sort_key   integer primary key,
  book       text not null references books(code),
  chapter    integer not null,
  verse      integer not null,
  ref        text not null,
  text       text not null,
  segments   text not null,
  footnotes  text not null,
  red_letter integer not null,
  passage_id integer not null references passages(id),
  unique (book, chapter, verse)
) strict;

-- Embedding units. Most are a whole pericope; long ones (Psalm 119, extended
-- narrative) are windowed so that a single vector still represents a coherent
-- span rather than an averaged blur.
create table chunks (
  id         integer primary key,
  passage_id integer not null references passages(id),
  ord        integer not null,
  ref        text not null,
  text       text not null,
  start_key  integer not null,
  end_key    integer not null
) strict;

create table chunk_vectors (
  chunk_id integer primary key references chunks(id),
  dim      integer not null,
  vec      blob not null
) strict;

create index verses_passage on verses(passage_id);
create index verses_book_chapter on verses(book, chapter);
create index passages_range on passages(start_key, end_key);
create index passages_book on passages(book);
create index chunks_passage on chunks(passage_id);

-- Verse-level lexical search gives precision: the exact wording a user echoes.
create virtual table verses_fts using fts5(
  text,
  content='verses',
  content_rowid='sort_key',
  tokenize='porter unicode61'
);

-- Passage-level lexical search gives recall, and lets the translators' own
-- section heading contribute to the match.
create virtual table passages_fts using fts5(
  heading,
  text,
  content='passages',
  content_rowid='id',
  tokenize='porter unicode61'
);
`;

export interface CorpusMeta {
  translation: string;
  translationName: string;
  license: string;
  release: string;
  schemaVersion: number;
  builtAt: string;
  bookCount: number;
  chapterCount: number;
  verseCount: number;
  passageCount: number;
  chunkCount: number;
  embeddingModel?: string;
  embeddingDim?: number;
  embeddingCount?: number;
}

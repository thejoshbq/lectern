/**
 * Hybrid retrieval over the corpus.
 *
 * Three signals, fused:
 *
 *   1. Verse-level BM25 — precision. Catches the exact wording a person
 *      echoes, and finds the single verse that names their situation.
 *   2. Passage-level BM25 — recall, and lets the translators' own section
 *      heading contribute ("Do Not Worry" matches an anxious request even
 *      when the passage body never uses the word).
 *   3. Dense vectors over chunks — semantic reach. Someone writing "I feel
 *      far from God" shares almost no vocabulary with Psalm 88, and only this
 *      signal will find it.
 *
 * The unit of retrieval is always the passage, never a loose verse. That is
 * the structural expression of this project's central rule: a citation is only
 * offered together with the context that governs it.
 *
 * Dense retrieval is optional throughout. With no vectors built, the first two
 * signals still produce good results, and every caller behaves identically.
 */

import { openCorpus, getPassages, type Passage } from "./corpus.ts";
import { getEmbeddingProvider } from "../embedding/provider.ts";

export interface RetrievalQuery {
  /** The user's own words. Always carries the most weight. */
  text: string;
  /**
   * Additional phrasings and biblical concepts from query expansion. These
   * broaden recall without letting the expansion drown out the original.
   */
  expansions?: string[];
  limit?: number;
}

export interface Candidate {
  passage: Passage;
  score: number;
  /** Which signals found this passage, for debugging and evaluation. */
  sources: string[];
  /** Verses that matched lexically, to focus the model's attention. */
  matchedRefs: string[];
}

/** Reciprocal-rank-fusion constant. 60 is the value from the original paper. */
const RRF_K = 60;

const DEFAULT_LIMIT = 40;
const PER_SIGNAL_LIMIT = 40;

/**
 * Dense retrieval is weighted well above lexical because of what the inputs
 * look like here. People write "I feel far from God and my prayers hit the
 * ceiling", and BM25 on that text is close to noise — it matched "Solomon's
 * Palace Complex" on the word "ceiling". Measured on the eval set, lexical
 * signals at equal weight actively degraded the fused ranking.
 *
 * Lexical still earns its place: it is the only signal that reliably finds a
 * passage when someone half-quotes it, or names a person or place.
 */
const WEIGHT_DENSE = 2.4;
const WEIGHT_LEXICAL = 0.7;
const WEIGHT_LEXICAL_EXPANDED = 1.0;

/**
 * Builds a safe FTS5 MATCH expression.
 *
 * User text goes into this directly, so every token is quoted: an apostrophe
 * in "God's" or a bare `OR` in a sentence would otherwise be parsed as query
 * syntax and either error or silently change the search.
 */
export function extractTerms(text: string, extra: string[] = []): string[] {
  const terms = new Set<string>();

  for (const source of [text, ...extra]) {
    for (const raw of source.toLowerCase().split(/[^a-z0-9']+/)) {
      const token = raw.replace(/^'+|'+$/g, "");
      if (token.length < 3) continue;
      if (STOP_WORDS.has(token)) continue;
      terms.add(token);
    }
  }

  return [...terms];
}

export function toFtsQuery(text: string, extra: string[] = []): string | null {
  const terms = extractTerms(text, extra);
  if (terms.length === 0) return null;

  // FTS5 escapes a double quote by doubling it.
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/**
 * Common English words plus the religious vocabulary that appears on nearly
 * every page of the Bible. Left in, "god" and "lord" match everything and
 * rank nothing.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "you", "your", "yours", "but",
  "not", "are", "was", "were", "have", "has", "had", "his", "her", "him", "she",
  "they", "them", "their", "our", "ours", "who", "whom", "what", "when", "where",
  "why", "how", "all", "any", "can", "will", "would", "could", "should", "there",
  "here", "from", "into", "onto", "than", "then", "them", "these", "those",
  "been", "being", "does", "did", "doing", "just", "like", "very", "much",
  "more", "most", "some", "such", "only", "own", "same", "too", "also", "about",
  "please", "help", "need", "want", "feel", "feeling", "know", "think",
  "god", "lord", "jesus", "christ", "bible", "scripture", "verse", "verses",
  "pray", "prayer", "praying", "amen",
]);

interface Ranked {
  passageId: number;
  rank: number;
  matchedRef?: string;
}

function searchVerses(query: string, limit: number): Ranked[] {
  const handle = openCorpus();
  const rows = handle
    .prepare(
      `select v.passage_id, v.ref, bm25(verses_fts) as score
         from verses_fts
         join verses v on v.sort_key = verses_fts.rowid
        where verses_fts match ?
        order by score
        limit ?`,
    )
    .all(query, limit) as { passage_id: number; ref: string }[];

  // Several verses of one passage may match; keep the best-ranked appearance
  // so a long passage does not crowd out everything else.
  const seen = new Set<number>();
  const ranked: Ranked[] = [];

  for (const row of rows) {
    if (seen.has(row.passage_id)) continue;
    seen.add(row.passage_id);
    ranked.push({
      passageId: row.passage_id,
      rank: ranked.length,
      matchedRef: row.ref,
    });
  }

  return ranked;
}

function searchPassages(query: string, limit: number): Ranked[] {
  const handle = openCorpus();
  const rows = handle
    .prepare(
      `select p.id, bm25(passages_fts, 2.0, 1.0) as score
         from passages_fts
         join passages p on p.id = passages_fts.rowid
        where passages_fts match ?
        order by score
        limit ?`,
    )
    .all(query, limit) as { id: number }[];

  return rows.map((row, i) => ({ passageId: row.id, rank: i }));
}

/**
 * Brute-force cosine similarity over every chunk vector.
 *
 * With roughly 3,600 chunks this is a few milliseconds and needs no vector
 * index, no extension, and no additional service. Vectors are stored
 * normalized, so the dot product is the cosine.
 */
async function searchDense(text: string, limit: number): Promise<Ranked[]> {
  const provider = await getEmbeddingProvider();
  if (!provider) return [];

  const handle = openCorpus();
  const rows = handle
    .prepare(
      `select cv.chunk_id, cv.dim, cv.vec, c.passage_id
         from chunk_vectors cv join chunks c on c.id = cv.chunk_id`,
    )
    .all() as {
    chunk_id: number;
    dim: number;
    vec: Uint8Array;
    passage_id: number;
  }[];

  if (rows.length === 0) return [];

  const query = await provider.embedQuery(text);

  if (rows[0].dim !== query.length) {
    // Vectors built with a different model are not comparable. Falling back to
    // lexical is the safe failure, and the corpus verifier reports the cause.
    console.warn(
      `Embedding dimension mismatch: corpus has ${rows[0].dim}, ` +
        `provider produced ${query.length}. Skipping dense retrieval.`,
    );
    return [];
  }

  const best = new Map<number, number>();

  for (const row of rows) {
    const vector = new Float32Array(
      row.vec.buffer,
      row.vec.byteOffset,
      row.vec.byteLength / 4,
    );

    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += query[i] * vector[i];

    // A passage takes its best-scoring chunk.
    const previous = best.get(row.passage_id);
    if (previous === undefined || dot > previous) {
      best.set(row.passage_id, dot);
    }
  }

  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([passageId], i) => ({ passageId, rank: i }));
}

/**
 * Drops lexical hits that matched on a single term.
 *
 * An OR query over ten words returns anything containing any one of them, so a
 * passage matching only "father" ranks alongside one matching "father",
 * "grief", and "comfort". Requiring two distinct terms removes most of that
 * noise while keeping genuine partial matches, and single-term matching is
 * still allowed when the query itself is only one or two words — someone
 * searching "shepherd" means it.
 */
function requireTermCoverage(items: Ranked[], terms: string[]): Ranked[] {
  const required = terms.length >= 4 ? 2 : 1;
  if (required <= 1) return items;

  const passages = getPassages(items.map((i) => i.passageId));
  const textById = new Map(
    passages.map((p) => [
      p.id,
      `${p.heading ?? ""} ${p.text}`.toLowerCase(),
    ]),
  );

  const kept: Ranked[] = [];
  for (const item of items) {
    const text = textById.get(item.passageId);
    if (!text) continue;

    let matched = 0;
    for (const term of terms) {
      if (text.includes(term)) matched++;
      if (matched >= required) break;
    }

    if (matched >= required) kept.push({ ...item, rank: kept.length });
  }

  return kept;
}

/**
 * Fuses ranked lists by reciprocal rank.
 *
 * RRF is used rather than score normalization because BM25 scores and cosine
 * similarities are not on comparable scales, and rank position is the only
 * thing the three signals genuinely agree on.
 */
function fuse(lists: { name: string; weight: number; items: Ranked[] }[]) {
  const scores = new Map<number, number>();
  const sources = new Map<number, Set<string>>();
  const matched = new Map<number, Set<string>>();

  for (const list of lists) {
    for (const item of list.items) {
      const contribution = list.weight / (RRF_K + item.rank + 1);
      scores.set(item.passageId, (scores.get(item.passageId) ?? 0) + contribution);

      const names = sources.get(item.passageId) ?? new Set<string>();
      names.add(list.name);
      sources.set(item.passageId, names);

      if (item.matchedRef) {
        const refs = matched.get(item.passageId) ?? new Set<string>();
        refs.add(item.matchedRef);
        matched.set(item.passageId, refs);
      }
    }
  }

  return { scores, sources, matched };
}

/**
 * Retrieves candidate passages for a request.
 *
 * The returned set is what the model is permitted to cite from. Nothing
 * outside it can survive verification, so recall here bounds the quality of
 * everything downstream.
 */
export async function retrieve(query: RetrievalQuery): Promise<Candidate[]> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const expansions = query.expansions ?? [];

  // The user's own words are searched on their own as well as together with
  // the expansions, so that expansion can add recall but cannot dilute the
  // original request.
  const primaryTerms = extractTerms(query.text);
  const broadTerms = extractTerms(query.text, expansions);

  const primaryQuery = toFtsQuery(query.text);
  const broadQuery = toFtsQuery(query.text, expansions);

  const lists: { name: string; weight: number; items: Ranked[] }[] = [];

  if (primaryQuery) {
    lists.push({
      name: "verse-bm25",
      weight: WEIGHT_LEXICAL,
      items: requireTermCoverage(
        searchVerses(primaryQuery, PER_SIGNAL_LIMIT),
        primaryTerms,
      ),
    });
    lists.push({
      name: "passage-bm25",
      weight: WEIGHT_LEXICAL,
      items: requireTermCoverage(
        searchPassages(primaryQuery, PER_SIGNAL_LIMIT),
        primaryTerms,
      ),
    });
  }

  if (broadQuery && broadQuery !== primaryQuery) {
    lists.push({
      name: "verse-bm25-expanded",
      weight: WEIGHT_LEXICAL_EXPANDED,
      items: requireTermCoverage(
        searchVerses(broadQuery, PER_SIGNAL_LIMIT),
        broadTerms,
      ),
    });
    lists.push({
      name: "passage-bm25-expanded",
      weight: WEIGHT_LEXICAL_EXPANDED,
      items: requireTermCoverage(
        searchPassages(broadQuery, PER_SIGNAL_LIMIT),
        broadTerms,
      ),
    });
  }

  // Dense retrieval reads the request as written, including the emotional
  // register that keyword search discards entirely.
  const denseText = [query.text, ...expansions.slice(0, 4)].join(". ");
  const dense = await searchDense(denseText, PER_SIGNAL_LIMIT);
  if (dense.length > 0) {
    lists.push({ name: "dense", weight: WEIGHT_DENSE, items: dense });
  }

  const { scores, sources, matched } = fuse(lists);

  const ordered = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const passages = getPassages(ordered.map(([id]) => id));
  const byId = new Map(passages.map((p) => [p.id, p]));

  const candidates: Candidate[] = [];
  for (const [id, score] of ordered) {
    const passage = byId.get(id);
    if (!passage) continue;
    candidates.push({
      passage,
      score,
      sources: [...(sources.get(id) ?? [])],
      matchedRefs: [...(matched.get(id) ?? [])],
    });
  }

  return candidates;
}

/** True when dense retrieval is available for this corpus and configuration. */
export async function denseRetrievalAvailable(): Promise<boolean> {
  const provider = await getEmbeddingProvider().catch(() => null);
  if (!provider) return false;
  const handle = openCorpus();
  const row = handle.prepare("select count(*) n from chunk_vectors").get() as {
    n: number;
  };
  return row.n > 0;
}

/**
 * Wire format between the server and the browser.
 *
 * Verse text crosses this boundary already resolved from the corpus. The
 * client never assembles Scripture, and never receives a reference it is
 * expected to look up — it renders exactly what verification produced.
 */

import type { VerifiedCitation } from "../bible/verify.ts";
import type { AskResult, Stage } from "./pipeline.ts";

export interface ClientVerse {
  chapter: number;
  verse: number;
  text: string;
  segments: { marker: string; text: string; wj?: boolean }[];
  redLetter: boolean;
  /** True when this verse is part of the cited range rather than context. */
  cited: boolean;
}

export interface ClientCitation {
  reference: string;
  heading: string | null;
  genre: string;
  testament: string;
  context: string;
  relevance?: string;
  /** Just the cited verses. */
  verses: ClientVerse[];
  /** The whole pericope, for the expandable context view. */
  passageRef: string;
  passageVerses: ClientVerse[];
  omittedWithin: { reference: string; note: string }[];
}

export interface ClientResult {
  kind: "answer" | "crisis";
  response: string;
  citations: ClientCitation[];
  prayer?: string;
  correction?: string;
  triageNote?: string;
  noRelevantScripture: boolean;
}

export type StreamEvent =
  | { type: "stage"; stage: Stage }
  | { type: "result"; result: ClientResult }
  | { type: "error"; message: string };

function toClientVerse(
  verse: {
    chapter: number;
    verse: number;
    text: string;
    segments: { marker: string; text: string; wj?: boolean }[];
    redLetter: boolean;
  },
  cited: boolean,
): ClientVerse {
  return {
    chapter: verse.chapter,
    verse: verse.verse,
    text: verse.text,
    segments: verse.segments,
    redLetter: verse.redLetter,
    cited,
  };
}

export function serializeCitation(citation: VerifiedCitation): ClientCitation {
  const citedKeys = new Set(citation.verses.map((v) => `${v.chapter}:${v.verse}`));

  return {
    reference: citation.reference,
    heading: citation.passage.heading,
    genre: citation.genre,
    testament: citation.passage.testament,
    context: citation.context,
    relevance: citation.relevance,
    verses: citation.verses.map((v) => toClientVerse(v, true)),
    passageRef: citation.passage.ref,
    passageVerses: citation.passageVerses.map((v) =>
      toClientVerse(v, citedKeys.has(`${v.chapter}:${v.verse}`)),
    ),
    omittedWithin: citation.omittedWithin,
  };
}

export function serializeResult(result: AskResult): ClientResult {
  return {
    kind: result.kind,
    response: result.response,
    citations: result.citations.map(serializeCitation),
    prayer: result.prayer,
    correction: result.correction,
    triageNote: result.triageNote,
    noRelevantScripture: result.noRelevantScripture,
  };
}

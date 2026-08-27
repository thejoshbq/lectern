/**
 * Types shared across the server/browser boundary.
 *
 * This file must stay a leaf: no imports from the pipeline, corpus, verifier,
 * or prompts. Client components type-import from here so Turbopack cannot
 * follow a type-only edge into Node-only modules (sqlite, fs, the model
 * client) and fail to hydrate the chat UI.
 */

export type Stage =
  | "checking"
  | "understanding"
  | "searching"
  | "reading"
  | "verifying"
  | "done";

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

/**
 * Citation verification: the gate every response passes through.
 *
 * The model never emits Scripture text. It emits references and its account of
 * why each one bears on the request. This module decides whether those
 * references are real, whether they came from what was actually retrieved, and
 * whether the model showed its work — and then renders the verse text itself,
 * from the corpus.
 *
 * That inversion is what makes fabrication structurally impossible rather than
 * merely discouraged. A reference the model invents does not resolve. A
 * reference it half-remembers from a different translation does not resolve. A
 * real reference it reached for without having read the surrounding passage is
 * not in the candidate set, and is refused for that reason alone.
 */

import type { Genre } from "./canon.ts";
import {
  findPassagesOverlapping,
  getPassageVerses,
  getVersesInRange,
  type Passage,
  type Verse,
} from "./corpus.ts";
import { omissionFor } from "./omissions.ts";
import {
  extractReferences,
  formatRange,
  parseReference,
  rangeStartKey,
  rangeVerseCount,
  type RangeRef,
} from "./reference.ts";

/** What the model proposes: a reference plus its justification. */
export interface ProposedCitation {
  reference: string;
  /**
   * How the passage's own context supports this use. Required — a citation
   * offered without an account of its context is exactly the proof-texting
   * this project rejects, so it is refused even when the reference is real.
   */
  context: string;
  /** Why this speaks to the request. */
  relevance?: string;
}

export interface VerifiedCitation {
  /** Normalized reference, formatted from the canon rather than the model. */
  reference: string;
  range: RangeRef;
  /** Verse text, read from the corpus. Never model-generated. */
  verses: Verse[];
  /** The pericope this citation sits inside. */
  passage: Passage;
  /** Every verse of that pericope, so the citation can be read in context. */
  passageVerses: Verse[];
  context: string;
  relevance?: string;
  genre: Genre;
  redLetter: boolean;
  /** Verse numbers inside the range that the BSB omits on manuscript grounds. */
  omittedWithin: { reference: string; note: string }[];
}

export type RejectionReason =
  | "unparseable"
  | "does-not-resolve"
  | "omitted-verse"
  | "outside-candidates"
  | "missing-context"
  | "excessive-range"
  | "duplicate";

export interface Rejection {
  reference: string;
  reason: RejectionReason;
  /** Message fed back to the model on retry. Written to be actionable. */
  detail: string;
}

export interface VerificationResult {
  citations: VerifiedCitation[];
  rejections: Rejection[];
  /** True when at least one citation survived and none were rejected. */
  ok: boolean;
}

export interface VerifyOptions {
  /**
   * Passage ids the model was shown. A citation must fall inside one of these.
   *
   * Omit only for direct lookup, where the user named the reference and no
   * retrieval took place.
   */
  allowedPassageIds?: Set<number>;
  /** Guards against a "citation" that is really a whole book. */
  maxVerses?: number;
  /** Minimum length of a contextual justification to count as one. */
  minContextLength?: number;
}

const DEFAULT_MAX_VERSES = 40;
const DEFAULT_MIN_CONTEXT = 20;

export function verifyCitations(
  proposed: ProposedCitation[],
  options: VerifyOptions = {},
): VerificationResult {
  const {
    allowedPassageIds,
    maxVerses = DEFAULT_MAX_VERSES,
    minContextLength = DEFAULT_MIN_CONTEXT,
  } = options;

  const citations: VerifiedCitation[] = [];
  const rejections: Rejection[] = [];
  const seen = new Set<string>();

  for (const item of proposed) {
    const raw = (item.reference ?? "").trim();

    const range = parseReference(raw);
    if (!range) {
      rejections.push({
        reference: raw,
        reason: "unparseable",
        detail:
          `"${raw}" is not a reference in the 66-book canon. ` +
          `Use the form "Book Chapter:Verse", e.g. "Romans 8:28" or "1 John 4:7-12".`,
      });
      continue;
    }

    const reference = formatRange(range);

    if (seen.has(reference)) {
      rejections.push({
        reference,
        reason: "duplicate",
        detail: `${reference} was cited more than once.`,
      });
      continue;
    }

    if (rangeVerseCount(range) > maxVerses) {
      rejections.push({
        reference,
        reason: "excessive-range",
        detail:
          `${reference} spans more than ${maxVerses} verses. ` +
          `Cite the specific verses that bear on the request; the surrounding ` +
          `passage is shown to the reader automatically.`,
      });
      continue;
    }

    const verses = getVersesInRange(range);

    if (verses.length === 0) {
      // A reference can be well-formed, and its verse number can exist in the
      // traditional versification, yet carry no text in this translation.
      // Saying which case it is beats a bare failure.
      const omission = omissionFor(
        range.book,
        range.startChapter,
        range.startVerse,
      );

      if (omission) {
        rejections.push({
          reference,
          reason: "omitted-verse",
          detail:
            `${omission.ref} is not present in the Berean Standard Bible. ` +
            `${omission.note} Cite a passage that is in the text.`,
        });
      } else {
        rejections.push({
          reference,
          reason: "does-not-resolve",
          detail: `${reference} does not resolve to any verse in the corpus.`,
        });
      }
      continue;
    }

    const overlapping = findPassagesOverlapping(range);
    if (overlapping.length === 0) {
      rejections.push({
        reference,
        reason: "does-not-resolve",
        detail: `${reference} resolves to no passage in the corpus.`,
      });
      continue;
    }

    if (allowedPassageIds) {
      const outside = overlapping.filter((p) => !allowedPassageIds.has(p.id));
      if (outside.length > 0) {
        rejections.push({
          reference,
          reason: "outside-candidates",
          detail:
            `${reference} was not among the passages provided. ` +
            `Cite only from the passages you were shown; they are the ones ` +
            `whose full context is available to you.`,
        });
        continue;
      }
    }

    const context = (item.context ?? "").trim();
    if (context.length < minContextLength) {
      rejections.push({
        reference,
        reason: "missing-context",
        detail:
          `${reference} was cited without explaining how the passage's own ` +
          `context supports this use. State what the passage is saying, to whom, ` +
          `and why that bears on the request.`,
      });
      continue;
    }

    // A citation is anchored in the passage its first verse belongs to.
    const passage = overlapping[0];
    const passageVerses = getPassageVerses(passage.id);

    // Report any verse numbers inside the cited range that the BSB omits, so
    // the reader is not left wondering why the numbering appears to skip.
    const present = new Set(verses.map((v) => `${v.chapter}:${v.verse}`));
    const omittedWithin: { reference: string; note: string }[] = [];
    for (const verse of expandRange(range)) {
      if (present.has(`${verse.chapter}:${verse.verse}`)) continue;
      const omission = omissionFor(range.book, verse.chapter, verse.verse);
      if (omission) {
        omittedWithin.push({ reference: omission.ref, note: omission.note });
      }
    }

    seen.add(reference);
    citations.push({
      reference,
      range,
      verses,
      passage,
      passageVerses,
      context,
      relevance: item.relevance?.trim() || undefined,
      genre: passage.genre,
      redLetter: verses.some((v) => v.redLetter),
      omittedWithin,
    });
  }

  return {
    citations,
    rejections,
    ok: citations.length > 0 && rejections.length === 0,
  };
}

/** Enumerates the verse coordinates a range covers, gaps included. */
function expandRange(range: RangeRef): { chapter: number; verse: number }[] {
  const out: { chapter: number; verse: number }[] = [];
  for (let chapter = range.startChapter; chapter <= range.endChapter; chapter++) {
    const from = chapter === range.startChapter ? range.startVerse : 1;
    const to = chapter === range.endChapter ? range.endVerse : 200;
    for (let verse = from; verse <= to; verse++) out.push({ chapter, verse });
    if (out.length > 400) break;
  }
  return out;
}

/**
 * Finds references the model wrote into its prose rather than declaring as
 * citations.
 *
 * Slipping "as Romans 8:28 says" into commentary is still a claim about what
 * Scripture teaches, and it bypasses every check above. The pipeline treats
 * any such reference as a citation that must be justified through the proper
 * channel, or removed.
 */
export function auditProse(
  prose: string,
  verified: VerifiedCitation[],
): { reference: string; detail: string }[] {
  const declared = new Set(verified.map((c) => c.reference));
  const problems: { reference: string; detail: string }[] = [];

  for (const range of extractReferences(prose)) {
    const reference = formatRange(range);
    if (declared.has(reference)) continue;

    // A reference inside an already-cited passage is a legitimate way to point
    // at part of what is being shown, so it is not flagged.
    const key = rangeStartKey(range);
    const withinDeclared = verified.some(
      (c) =>
        c.passage.book === range.book &&
        c.passage.startKey <= key &&
        key <= c.passage.endKey,
    );
    if (withinDeclared) continue;

    problems.push({
      reference,
      detail:
        `The response mentions ${reference} in prose without citing it. ` +
        `Every reference must go through the citation list so its text and ` +
        `context can be shown, or be removed.`,
    });
  }

  return problems;
}

/** Collapses punctuation and spacing so quotations can be compared fairly. */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds quoted text in the response that does not appear in any cited passage.
 *
 * The model is told not to quote Scripture, because the verse text is rendered
 * beside its words from the corpus. This catches the case where it does anyway
 * and misremembers the wording — the subtlest failure mode available to it,
 * since a slightly-wrong quotation of a real verse looks entirely convincing.
 */
export function auditQuotations(
  prose: string,
  verified: VerifiedCitation[],
): { quotation: string; detail: string }[] {
  // Only substantial quotations are worth checking; short quoted phrases are
  // usually the user's own words being reflected back.
  const MIN_WORDS = 5;

  const haystack = verified
    .map((c) => normalizeForComparison(c.passageVerses.map((v) => v.text).join(" ")))
    .join(" \u0000 ");

  const problems: { quotation: string; detail: string }[] = [];

  for (const match of prose.matchAll(/[""]([^""]{12,400})[""]|"([^"]{12,400})"/g)) {
    const quotation = (match[1] ?? match[2] ?? "").trim();
    const normalized = normalizeForComparison(quotation);
    if (normalized.split(" ").length < MIN_WORDS) continue;

    if (!haystack.includes(normalized)) {
      problems.push({
        quotation,
        detail:
          `The response quotes "${quotation.slice(0, 80)}..." but that wording ` +
          `does not appear in any cited passage. Do not quote Scripture; refer ` +
          `to the passage by reference and let its text be shown alongside.`,
      });
    }
  }

  return problems;
}

/**
 * Places verified citations inside the model's prose.
 *
 * The model never writes verse text. It names passages by reference; this
 * module decides where those (already-rendered) citations sit in the reading
 * order so the summary and the Scripture can be read together.
 */

import {
  extractReferences,
  formatRange,
  parseReference,
  rangeContains,
  rangesOverlap,
  type RangeRef,
} from "../bible/reference.ts";

export type AnswerBlock =
  | { type: "prose"; text: string }
  | { type: "citation"; reference: string };

export interface ComposableCitation {
  reference: string;
}

interface Resolved {
  reference: string;
  range: RangeRef | null;
}

/**
 * Turns a response and its citations into a single reading sequence.
 *
 * A paragraph that is only a reference is treated as a slot: the citation
 * replaces the line. Otherwise a citation is inserted after the first
 * paragraph that names it. Anything never named is appended at the end.
 */
export function composeAnswer(
  response: string,
  citations: ComposableCitation[],
): AnswerBlock[] {
  const unused: Resolved[] = citations.map((citation) => ({
    reference: citation.reference,
    range: parseReference(citation.reference),
  }));

  const blocks: AnswerBlock[] = [];
  const paragraphs = response.split(/\n{2,}/).filter((p) => p.trim());

  for (const paragraph of paragraphs) {
    const slot = asReferenceSlot(paragraph);
    if (slot) {
      const index = matchUnused(slot, unused);
      if (index >= 0) {
        blocks.push({ type: "citation", reference: unused[index].reference });
        unused.splice(index, 1);
        continue;
      }
    }

    blocks.push({ type: "prose", text: paragraph });

    for (const mentioned of extractReferences(paragraph)) {
      const index = matchUnused(mentioned, unused);
      if (index < 0) continue;
      blocks.push({ type: "citation", reference: unused[index].reference });
      unused.splice(index, 1);
    }
  }

  for (const leftover of unused) {
    blocks.push({ type: "citation", reference: leftover.reference });
  }

  return blocks;
}

/** A paragraph that is nothing but a reference (optional trailing punctuation). */
function asReferenceSlot(paragraph: string): RangeRef | null {
  const trimmed = paragraph.trim();
  return (
    parseReference(trimmed) ??
    parseReference(trimmed.replace(/[.:;]+$/, ""))
  );
}

/**
 * Prefer an exact range match, then a citation that contains the mention,
 * then any overlapping citation. First unused wins within each class.
 */
function matchUnused(mentioned: RangeRef, unused: Resolved[]): number {
  const exact = formatRange(mentioned);

  const exactIndex = unused.findIndex(
    (citation) =>
      citation.reference === exact ||
      (citation.range !== null && formatRange(citation.range) === exact),
  );
  if (exactIndex >= 0) return exactIndex;

  const containing = unused.findIndex(
    (citation) => citation.range !== null && rangeContains(citation.range, mentioned),
  );
  if (containing >= 0) return containing;

  return unused.findIndex(
    (citation) => citation.range !== null && rangesOverlap(citation.range, mentioned),
  );
}

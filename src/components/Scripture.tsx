"use client";

import { useState } from "react";

import type { ClientCitation, ClientVerse } from "@/lib/agent/serialize";

/**
 * Scripture rendering.
 *
 * Two decisions carry weight here.
 *
 * Scripture is set in a serif face and everything the tool says is set in
 * sans. The reader can tell at a glance, without reading a word, which text is
 * God's and which is software's. That distinction is the whole ethic of this
 * project expressed as typography.
 *
 * Poetry keeps its lineation. Roughly a third of the Bible is verse, and
 * flattening Hebrew parallelism into prose paragraphs loses information the
 * translators deliberately encoded.
 */

const POETRY_INDENT: Record<string, string> = {
  q1: "pl-0",
  q2: "pl-6",
  q3: "pl-10",
  q4: "pl-14",
  qr: "pl-12 italic",
  qc: "text-center",
  qa: "italic text-ink-faint",
  d: "italic text-ink-muted",
  li1: "pl-4",
  li2: "pl-8",
  pc: "text-center",
};

function isPoetry(marker: string): boolean {
  return marker.startsWith("q") || marker === "d";
}

interface VerseLine {
  marker: string;
  runs: { text: string; wj?: boolean }[];
  /** Verse number, shown only at the start of a verse. */
  number?: number;
  cited: boolean;
}

/**
 * Groups segments into display lines.
 *
 * A single verse can span several poetic lines, and a single prose paragraph
 * can contain several verses, so neither verses nor paragraphs alone are the
 * right unit for layout.
 */
function toLines(verses: ClientVerse[]): VerseLine[] {
  const lines: VerseLine[] = [];

  for (const verse of verses) {
    let first = true;

    for (const segment of verse.segments) {
      const text = segment.text.replace(/\s+/g, " ");
      if (!text.trim()) continue;

      const previous = lines[lines.length - 1];
      const continuesProse =
        previous !== undefined &&
        !first &&
        previous.marker === segment.marker &&
        !isPoetry(segment.marker);

      if (continuesProse) {
        previous.runs.push({ text, wj: segment.wj });
        continue;
      }

      lines.push({
        marker: segment.marker,
        runs: [{ text, wj: segment.wj }],
        number: first ? verse.verse : undefined,
        cited: verse.cited,
      });
      first = false;
    }

    // A verse whose segments were all whitespace still deserves its number.
    if (first) {
      lines.push({
        marker: "p",
        runs: [{ text: verse.text }],
        number: verse.verse,
        cited: verse.cited,
      });
    }
  }

  return lines;
}

export function VerseText({
  verses,
  dimUncited = false,
}: {
  verses: ClientVerse[];
  dimUncited?: boolean;
}) {
  const lines = toLines(verses);

  return (
    <div className="font-scripture text-[1.0625rem] leading-[1.75]">
      {lines.map((line, i) => {
        const indent = POETRY_INDENT[line.marker] ?? "";
        const muted = dimUncited && !line.cited;

        return (
          <p
            key={i}
            className={[
              indent,
              muted ? "text-ink-faint" : "text-ink",
              isPoetry(line.marker) ? "" : "mb-2",
              "transition-colors",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {line.number !== undefined && (
              <sup className="text-ink-faint mr-1 align-super font-sans text-[0.6875rem] select-none">
                {line.number}
              </sup>
            )}
            {line.runs.map((run, j) => (
              <span
                key={j}
                className={run.wj ? "text-[#c07a68]" : undefined}
                title={run.wj ? "Words of Jesus" : undefined}
              >
                {run.text}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function Citation({ citation }: { citation: ClientCitation }) {
  const [expanded, setExpanded] = useState(false);

  const hasMoreContext =
    citation.passageVerses.length > citation.verses.length;

  return (
    <figure className="border-line bg-raised/60 overflow-hidden rounded-lg border">
      <figcaption className="border-line/70 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <cite className="text-accent text-sm font-medium tracking-wide not-italic">
          {expanded ? citation.passageRef : citation.reference}
        </cite>
        {citation.heading && (
          <span className="text-ink-faint truncate text-xs">
            {citation.heading}
          </span>
        )}
      </figcaption>

      <div className="px-4 py-3.5">
        <VerseText
          verses={expanded ? citation.passageVerses : citation.verses}
          dimUncited={expanded}
        />
      </div>

      {citation.omittedWithin.length > 0 && (
        <div className="border-line/70 text-ink-faint border-t px-4 py-2 text-xs">
          {citation.omittedWithin.map((o) => (
            <p key={o.reference}>
              {o.reference} is not in this translation. {o.note}
            </p>
          ))}
        </div>
      )}

      <div className="border-line/70 flex items-center justify-between gap-3 border-t px-4 py-2">
        <p className="text-ink-faint text-xs leading-relaxed">
          {citation.context}
        </p>
        {hasMoreContext && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-ink-muted hover:text-ink focus-visible:ring-accent/50 shrink-0 rounded px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-expanded={expanded}
          >
            {expanded ? "Show verse" : "Read in context"}
          </button>
        )}
      </div>
    </figure>
  );
}

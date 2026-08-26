/**
 * The guarantee, tested against hostile model output.
 *
 * These run with no API key and no network. Rather than hoping a live model
 * misbehaves on cue, they feed the verification gate exactly the outputs a
 * misbehaving model would produce and assert that none of them survive.
 *
 * If this file passes, then no matter what the model returns, the only
 * Scripture that can reach a reader is text read from the corpus, at a
 * reference that resolves, inside a passage that was actually retrieved.
 */

import { describe, expect, it } from "vitest";

import { findPassageContaining, getPassageVerses } from "../src/lib/bible/corpus.ts";
import {
  auditProse,
  auditQuotations,
  verifyCitations,
  type ProposedCitation,
} from "../src/lib/bible/verify.ts";

const CONTEXT =
  "Paul is writing to believers in Rome, concluding an argument about " +
  "suffering in the present age and the certainty of God's purpose.";

function passageIdFor(book: string, chapter: number, verse: number): number {
  const passage = findPassageContaining({ book, chapter, verse });
  if (!passage) throw new Error(`No passage for ${book} ${chapter}:${verse}`);
  return passage.id;
}

/** A realistic allow-list, as the pipeline would build it after retrieval. */
const ALLOWED = new Set([
  passageIdFor("ROM", 8, 28),
  passageIdFor("PSA", 23, 1),
  passageIdFor("MAT", 6, 26),
]);

describe("fabricated citations never survive", () => {
  const fabrications: { name: string; citation: ProposedCitation }[] = [
    {
      name: "a book that does not exist",
      citation: { reference: "Hezekiah 3:16", context: CONTEXT },
    },
    {
      name: "an apocryphal book",
      citation: { reference: "1 Maccabees 2:1", context: CONTEXT },
    },
    {
      name: "a chapter past the end of a real book",
      citation: { reference: "Jude 4:2", context: CONTEXT },
    },
    {
      name: "a verse past the end of a real chapter",
      citation: { reference: "Psalm 23:14", context: CONTEXT },
    },
    {
      name: "a plausible-sounding invention",
      citation: { reference: "2 Corinthians 14:3", context: CONTEXT },
    },
    {
      name: "prose masquerading as a reference",
      citation: { reference: "God helps those who help themselves", context: CONTEXT },
    },
    {
      name: "an empty reference",
      citation: { reference: "", context: CONTEXT },
    },
    {
      name: "a verse omitted from this translation",
      citation: { reference: "Matthew 17:21", context: CONTEXT },
    },
  ];

  for (const { name, citation } of fabrications) {
    it(`rejects ${name}`, () => {
      const result = verifyCitations([citation], { allowedPassageIds: ALLOWED });
      expect(result.citations).toHaveLength(0);
      expect(result.rejections).toHaveLength(1);
    });
  }

  it("rejects every fabrication in a single batch while keeping the real one", () => {
    const proposed: ProposedCitation[] = [
      ...fabrications.map((f) => f.citation),
      { reference: "Romans 8:28", context: CONTEXT },
    ];
    const result = verifyCitations(proposed, { allowedPassageIds: ALLOWED });

    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);
    expect(result.rejections).toHaveLength(fabrications.length);
  });
});

describe("real references outside the retrieved set never survive", () => {
  // This is the check that separates this design from prompt-based approaches.
  // The model reaching for a verse it knows, rather than one it was shown, is
  // the most likely failure in practice, and the least likely to look wrong.
  const outsiders = [
    "John 3:16",
    "Jeremiah 29:11",
    "Philippians 4:13",
    "Proverbs 3:5",
  ];

  for (const reference of outsiders) {
    it(`rejects ${reference} when it was not retrieved`, () => {
      const result = verifyCitations([{ reference, context: CONTEXT }], {
        allowedPassageIds: ALLOWED,
      });
      expect(result.citations).toHaveLength(0);
      expect(result.rejections[0].reason).toBe("outside-candidates");
    });
  }
});

describe("citations without context never survive", () => {
  for (const context of ["", "   ", "Good verse.", "Relevant."]) {
    it(`rejects a citation justified only with ${JSON.stringify(context)}`, () => {
      const result = verifyCitations(
        [{ reference: "Romans 8:28", context }],
        { allowedPassageIds: ALLOWED },
      );
      expect(result.citations).toHaveLength(0);
      expect(result.rejections[0].reason).toBe("missing-context");
    });
  }
});

describe("rendered text always comes from the corpus", () => {
  it("ignores any text the model supplies and reads the verse itself", () => {
    const result = verifyCitations(
      [
        {
          reference: "Psalm 23:1",
          context:
            "David's psalm of confidence, using the shepherd image for God's care.",
          // A model could put anything here; the gate never reads it as text.
          relevance: "The LORD is my banker; I shall not want for money.",
        },
      ],
      { allowedPassageIds: ALLOWED },
    );

    expect(result.citations).toHaveLength(1);
    const rendered = result.citations[0].verses.map((v) => v.text).join(" ");
    expect(rendered).toContain("The LORD is my shepherd");
    expect(rendered).not.toContain("banker");
  });

  it("renders text identical to the corpus, verbatim", () => {
    const result = verifyCitations(
      [{ reference: "Romans 8:28", context: CONTEXT }],
      { allowedPassageIds: ALLOWED },
    );
    const citation = result.citations[0];
    const fromCorpus = getPassageVerses(citation.passage.id).find(
      (v) => v.chapter === 8 && v.verse === 28,
    );
    expect(citation.verses[0].text).toBe(fromCorpus!.text);
  });

  it("carries the full surrounding passage with every citation", () => {
    // Context is not optional metadata; it ships with the citation so the
    // reader can always see what governs it.
    const result = verifyCitations(
      [{ reference: "Romans 8:28", context: CONTEXT }],
      { allowedPassageIds: ALLOWED },
    );
    const citation = result.citations[0];
    expect(citation.passageVerses.length).toBeGreaterThan(citation.verses.length);
    expect(citation.passage.heading).toBeTruthy();
  });
});

describe("prose is audited too", () => {
  it("flags a reference smuggled into prose", () => {
    const problems = auditProse(
      "Take heart — as it says in Jeremiah 29:11, God has plans to prosper you.",
      [],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].reference).toBe("Jeremiah 29:11");
  });

  it("flags a misquotation of a real passage", () => {
    // The subtlest failure available: a real reference, quoted almost right.
    const { citations } = verifyCitations(
      [{ reference: "Psalm 23:1", context: "David's psalm of confidence in God's care." }],
      { allowedPassageIds: ALLOWED },
    );
    const problems = auditQuotations(
      'Scripture says, "The Lord is my shepherd, I shall not want for anything at all."',
      citations,
    );
    expect(problems).toHaveLength(1);
  });

  it("accepts a quotation that matches the corpus exactly", () => {
    const { citations } = verifyCitations(
      [{ reference: "Psalm 23:1", context: "David's psalm of confidence in God's care." }],
      { allowedPassageIds: ALLOWED },
    );
    const problems = auditQuotations(
      'The psalm opens, "The LORD is my shepherd; I shall not want."',
      citations,
    );
    expect(problems).toEqual([]);
  });
});

describe("degenerate model output is handled", () => {
  it("returns nothing rather than failing when the model cites nothing", () => {
    const result = verifyCitations([], { allowedPassageIds: ALLOWED });
    expect(result.citations).toEqual([]);
    expect(result.rejections).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("refuses a citation spanning an entire book", () => {
    const result = verifyCitations(
      [{ reference: "Psalm 119:1-176", context: CONTEXT }],
      {},
    );
    expect(result.rejections[0].reason).toBe("excessive-range");
  });
});

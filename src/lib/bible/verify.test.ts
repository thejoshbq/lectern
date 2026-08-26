import { describe, expect, it } from "vitest";

import { findPassageContaining } from "./corpus.ts";
import { auditProse, verifyCitations } from "./verify.ts";

/** Resolves the passage id containing a reference, for building allow-lists. */
function passageIdFor(book: string, chapter: number, verse: number): number {
  const passage = findPassageContaining({ book, chapter, verse });
  if (!passage) throw new Error(`No passage contains ${book} ${chapter}:${verse}`);
  return passage.id;
}

const GOOD_CONTEXT =
  "Paul is concluding his argument about present suffering and future glory, " +
  "addressed to believers in Rome.";

describe("verifyCitations", () => {
  it("accepts a real reference from an allowed passage and renders its text", () => {
    const id = passageIdFor("ROM", 8, 28);
    const result = verifyCitations(
      [{ reference: "Romans 8:28", context: GOOD_CONTEXT }],
      { allowedPassageIds: new Set([id]) },
    );

    expect(result.ok).toBe(true);
    expect(result.citations).toHaveLength(1);

    const citation = result.citations[0];
    expect(citation.reference).toBe("Romans 8:28");
    // The text comes from the corpus, never from the caller.
    expect(citation.verses[0].text).toContain("God works all things together");
    expect(citation.passageVerses.length).toBeGreaterThan(1);
    expect(citation.genre).toBe("epistle");
  });

  it("rejects a fabricated book", () => {
    const result = verifyCitations(
      [{ reference: "Hezekiah 3:16", context: GOOD_CONTEXT }],
      {},
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("unparseable");
  });

  it("rejects a chapter that does not exist in a real book", () => {
    const result = verifyCitations(
      [{ reference: "Jude 5:1", context: GOOD_CONTEXT }],
      {},
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("unparseable");
  });

  it("rejects a verse beyond the end of a real chapter", () => {
    const result = verifyCitations(
      [{ reference: "Psalm 23:99", context: GOOD_CONTEXT }],
      {},
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("does-not-resolve");
  });

  it("explains why a verse omitted on manuscript grounds is unavailable", () => {
    const result = verifyCitations(
      [{ reference: "Matthew 17:21", context: GOOD_CONTEXT }],
      {},
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("omitted-verse");
    expect(result.rejections[0].detail).toContain("earliest manuscripts");
  });

  it("refuses a real reference that was not among the retrieved passages", () => {
    // The heart of the guarantee: being real is not sufficient. The model may
    // only cite what it was actually shown, in context.
    const allowed = new Set([passageIdFor("ROM", 8, 28)]);
    const result = verifyCitations(
      [{ reference: "John 3:16", context: GOOD_CONTEXT }],
      { allowedPassageIds: allowed },
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("outside-candidates");
  });

  it("refuses a citation offered without contextual justification", () => {
    const id = passageIdFor("ROM", 8, 28);
    const result = verifyCitations(
      [{ reference: "Romans 8:28", context: "It is nice." }],
      { allowedPassageIds: new Set([id]) },
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("missing-context");
  });

  it("refuses a range long enough to be a whole book", () => {
    const result = verifyCitations(
      [{ reference: "Psalm 119:1-176", context: GOOD_CONTEXT }],
      {},
    );
    expect(result.citations).toHaveLength(0);
    expect(result.rejections[0].reason).toBe("excessive-range");
  });

  it("refuses duplicates", () => {
    const id = passageIdFor("ROM", 8, 28);
    const result = verifyCitations(
      [
        { reference: "Romans 8:28", context: GOOD_CONTEXT },
        { reference: "Romans 8:28", context: GOOD_CONTEXT },
      ],
      { allowedPassageIds: new Set([id]) },
    );
    expect(result.citations).toHaveLength(1);
    expect(result.rejections[0].reason).toBe("duplicate");
  });

  it("keeps good citations while rejecting bad ones in the same batch", () => {
    const allowed = new Set([passageIdFor("ROM", 8, 28)]);
    const result = verifyCitations(
      [
        { reference: "Romans 8:28", context: GOOD_CONTEXT },
        { reference: "Hezekiah 1:1", context: GOOD_CONTEXT },
      ],
      { allowedPassageIds: allowed },
    );
    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);
    expect(result.rejections).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("resolves multi-verse ranges in canonical order", () => {
    const id = passageIdFor("1CO", 13, 4);
    const result = verifyCitations(
      [{ reference: "1 Corinthians 13:4-7", context: GOOD_CONTEXT }],
      { allowedPassageIds: new Set([id]) },
    );
    expect(result.ok).toBe(true);
    const verses = result.citations[0].verses;
    expect(verses).toHaveLength(4);
    expect(verses.map((v) => v.verse)).toEqual([4, 5, 6, 7]);
    expect(verses[0].text).toContain("Love is patient");
  });

  it("marks words of Jesus", () => {
    const id = passageIdFor("JHN", 3, 16);
    const result = verifyCitations(
      [{ reference: "John 3:16", context: GOOD_CONTEXT }],
      { allowedPassageIds: new Set([id]) },
    );
    expect(result.citations[0].redLetter).toBe(true);
  });
});

describe("auditProse", () => {
  it("flags a reference slipped into prose without being cited", () => {
    const problems = auditProse(
      "Remember that God works all things for good, as Romans 8:28 tells us.",
      [],
    );
    expect(problems.map((p) => p.reference)).toEqual(["Romans 8:28"]);
  });

  it("allows references that were properly cited", () => {
    const id = passageIdFor("ROM", 8, 28);
    const { citations } = verifyCitations(
      [{ reference: "Romans 8:28", context: GOOD_CONTEXT }],
      { allowedPassageIds: new Set([id]) },
    );
    expect(auditProse("As Romans 8:28 says, ...", citations)).toEqual([]);
  });

  it("allows a reference inside an already-cited passage", () => {
    // Pointing at a neighbouring verse of a passage already on screen is
    // legitimate; its context is right there.
    const id = passageIdFor("ROM", 8, 28);
    const { citations } = verifyCitations(
      [{ reference: "Romans 8:28", context: GOOD_CONTEXT }],
      { allowedPassageIds: new Set([id]) },
    );
    expect(auditProse("Notice too what Romans 8:31 asks.", citations)).toEqual([]);
  });

  it("ignores prose with no references", () => {
    expect(auditProse("Take this to the Lord in prayer today.", [])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { BOOKS, BOOK_COUNT, CHAPTER_COUNT, lookupBook } from "./canon.ts";
import {
  extractReferences,
  formatRange,
  parseReference,
  rangeContains,
  rangesOverlap,
  sortKeyToRef,
  verseSortKey,
} from "./reference.ts";

describe("canon", () => {
  it("holds the 66-book Protestant canon in order", () => {
    expect(BOOK_COUNT).toBe(66);
    expect(BOOKS[0].code).toBe("GEN");
    expect(BOOKS[65].code).toBe("REV");
    expect(BOOKS.map((b) => b.order)).toEqual(
      Array.from({ length: 66 }, (_, i) => i + 1),
    );
  });

  it("totals 1189 chapters", () => {
    expect(CHAPTER_COUNT).toBe(1189);
  });

  it("resolves common citation spellings", () => {
    expect(lookupBook("1 Cor")?.code).toBe("1CO");
    expect(lookupBook("1cor")?.code).toBe("1CO");
    expect(lookupBook("I Corinthians")?.code).toBe("1CO");
    expect(lookupBook("First Corinthians")?.code).toBe("1CO");
    expect(lookupBook("Song of Songs")?.code).toBe("SNG");
    expect(lookupBook("Psalm")?.code).toBe("PSA");
    expect(lookupBook("PSALMS")?.code).toBe("PSA");
    expect(lookupBook("Phlm.")?.code).toBe("PHM");
  });

  it("rejects names outside the canon", () => {
    expect(lookupBook("Enoch")).toBeUndefined();
    expect(lookupBook("Maccabees")).toBeUndefined();
    expect(lookupBook("Hezekiah")).toBeUndefined();
    expect(lookupBook("")).toBeUndefined();
  });

  it("keeps every alias unambiguous", () => {
    // Duplicate aliases would silently resolve citations to the wrong book.
    const seen = new Map<string, string>();
    for (const book of BOOKS) {
      for (const alias of [book.code.toLowerCase(), book.name.toLowerCase(), ...book.aliases]) {
        const key = alias.toLowerCase().replace(/[.\s]/g, "");
        const owner = seen.get(key);
        expect(owner === undefined || owner === book.code).toBe(true);
        seen.set(key, book.code);
      }
    }
  });
});

describe("parseReference", () => {
  it("parses a single verse", () => {
    expect(parseReference("John 3:16")).toEqual({
      book: "JHN",
      startChapter: 3,
      startVerse: 16,
      endChapter: 3,
      endVerse: 16,
    });
  });

  it("parses a verse range within a chapter", () => {
    expect(parseReference("1 Corinthians 13:4-7")).toEqual({
      book: "1CO",
      startChapter: 13,
      startVerse: 4,
      endChapter: 13,
      endVerse: 7,
    });
  });

  it("parses a range crossing chapters", () => {
    expect(parseReference("Romans 8:31-9:5")).toEqual({
      book: "ROM",
      startChapter: 8,
      startVerse: 31,
      endChapter: 9,
      endVerse: 5,
    });
  });

  it("accepts en dashes and loose spacing", () => {
    expect(parseReference("Psalm 23 : 1 \u2013 3")).toEqual({
      book: "PSA",
      startChapter: 23,
      startVerse: 1,
      endChapter: 23,
      endVerse: 3,
    });
  });

  it("treats a bare number in a one-chapter book as a verse", () => {
    expect(parseReference("Jude 24")).toEqual({
      book: "JUD",
      startChapter: 1,
      startVerse: 24,
      endChapter: 1,
      endVerse: 24,
    });
    expect(parseReference("Philemon 6")).toEqual({
      book: "PHM",
      startChapter: 1,
      startVerse: 6,
      endChapter: 1,
      endVerse: 6,
    });
  });

  it("rejects chapters beyond the book", () => {
    expect(parseReference("Jude 2:1")).toBeNull();
    expect(parseReference("Genesis 51:1")).toBeNull();
    expect(parseReference("Revelation 23:1")).toBeNull();
  });

  it("rejects books outside the canon", () => {
    expect(parseReference("Hezekiah 3:16")).toBeNull();
    expect(parseReference("2 Enoch 1:1")).toBeNull();
  });

  it("rejects inverted ranges", () => {
    expect(parseReference("John 3:16-10")).toBeNull();
    expect(parseReference("Romans 9:5-8:31")).toBeNull();
  });

  it("requires a verse unless whole units are explicitly allowed", () => {
    // Citing a whole book as support for a claim is the imprecision this
    // project exists to avoid, so it must be opted into.
    expect(parseReference("Romans")).toBeNull();
    expect(parseReference("Romans 8")).toBeNull();
    expect(parseReference("Romans 8", { allowWhole: true })).toMatchObject({
      book: "ROM",
      startChapter: 8,
      startVerse: 1,
    });
  });

  it("rejects nonsense", () => {
    expect(parseReference("")).toBeNull();
    expect(parseReference("see the attached")).toBeNull();
    expect(parseReference("3:16")).toBeNull();
  });
});

describe("formatRange", () => {
  it("prints single verses, ranges, and cross-chapter spans", () => {
    expect(formatRange(parseReference("John 3:16")!)).toBe("John 3:16");
    expect(formatRange(parseReference("1 Cor 13:4-7")!)).toBe(
      "1 Corinthians 13:4-7",
    );
    expect(formatRange(parseReference("Rom 8:31-9:5")!)).toBe(
      "Romans 8:31-9:5",
    );
  });

  it("omits the chapter for one-chapter books", () => {
    expect(formatRange(parseReference("Jude 24")!)).toBe("Jude 24");
    expect(formatRange(parseReference("Jude 24-25")!)).toBe("Jude 24-25");
  });

  it("round-trips through parsing", () => {
    for (const input of ["Genesis 1:1", "Psalms 119:105", "Revelation 22:21"]) {
      const parsed = parseReference(input)!;
      expect(formatRange(parsed)).toBe(input.replace("Psalms", "Psalms"));
      expect(parseReference(formatRange(parsed))).toEqual(parsed);
    }
  });
});

describe("sort keys", () => {
  it("orders verses canonically", () => {
    const gen = verseSortKey({ book: "GEN", chapter: 1, verse: 1 });
    const psa = verseSortKey({ book: "PSA", chapter: 23, verse: 1 });
    const rev = verseSortKey({ book: "REV", chapter: 22, verse: 21 });
    expect(gen).toBeLessThan(psa);
    expect(psa).toBeLessThan(rev);
  });

  it("round-trips", () => {
    const ref = { book: "JHN", chapter: 3, verse: 16 };
    expect(sortKeyToRef(verseSortKey(ref))).toEqual(ref);
  });
});

describe("range relations", () => {
  const romans8 = parseReference("Romans 8:28-39")!;

  it("detects overlap", () => {
    expect(rangesOverlap(romans8, parseReference("Romans 8:31")!)).toBe(true);
    expect(rangesOverlap(romans8, parseReference("Romans 8:1")!)).toBe(false);
    expect(rangesOverlap(romans8, parseReference("John 3:16")!)).toBe(false);
  });

  it("detects containment", () => {
    expect(rangeContains(romans8, parseReference("Romans 8:31-32")!)).toBe(true);
    expect(rangeContains(romans8, parseReference("Romans 8:26-30")!)).toBe(false);
  });
});

describe("extractReferences", () => {
  it("finds citations embedded in prose", () => {
    const found = extractReferences(
      "As Paul writes in Romans 8:28, and again in 1 Cor 13:4-7, we see this.",
    );
    expect(found.map(formatRange)).toEqual([
      "Romans 8:28",
      "1 Corinthians 13:4-7",
    ]);
  });

  it("ignores prose with no citations", () => {
    expect(extractReferences("Pray without ceasing, dear friend.")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { composeAnswer } from "./compose.ts";

const ROMANS = { reference: "Romans 8:28-30" };
const MATTHEW = { reference: "Matthew 6:25-34" };
const PSALMS = { reference: "Psalms 23:1-4" };

describe("composeAnswer", () => {
  it("inserts a citation after the paragraph that first names it", () => {
    const blocks = composeAnswer(
      "God's Word reminds us that anxiety about tomorrow is not new.\n\n" +
        "Matthew 6:25-34 is Jesus teaching His disciples not to be anxious " +
        "about food and clothing.\n\n" +
        "That is a summons to trust the Giver, not a timeline for rent.",
      [MATTHEW],
    );

    expect(blocks).toEqual([
      {
        type: "prose",
        text: "God's Word reminds us that anxiety about tomorrow is not new.",
      },
      {
        type: "prose",
        text:
          "Matthew 6:25-34 is Jesus teaching His disciples not to be anxious " +
          "about food and clothing.",
      },
      { type: "citation", reference: "Matthew 6:25-34" },
      {
        type: "prose",
        text: "That is a summons to trust the Giver, not a timeline for rent.",
      },
    ]);
  });

  it("interleaves several citations in the order they are named", () => {
    const blocks = composeAnswer(
      "Matthew 6:25-34 names the Father's care.\n\n" +
        "Romans 8:28-30 then places present trouble inside God's purpose.",
      [ROMANS, MATTHEW],
    );

    expect(blocks.map((b) => (b.type === "citation" ? b.reference : b.type))).toEqual([
      "prose",
      "Matthew 6:25-34",
      "prose",
      "Romans 8:28-30",
    ]);
  });

  it("interleaves smaller ranges from one passage with analysis between them", () => {
    const blocks = composeAnswer(
      "God's Word meets worry without promising a pleasant outcome.\n\n" +
        "Matthew 6:25-27\n\n" +
        "Jesus is speaking to disciples about daily provision, not issuing a formula for rent.\n\n" +
        "Matthew 6:28-30\n\n" +
        "The argument then turns from food to clothing, still under the Father's care.\n\n" +
        "Matthew 6:31-34\n\n" +
        "The close is a summons to seek the kingdom rather than a timeline.",
      [
        { reference: "Matthew 6:25-27" },
        { reference: "Matthew 6:28-30" },
        { reference: "Matthew 6:31-34" },
      ],
    );

    expect(blocks.map((b) => (b.type === "citation" ? b.reference : "prose"))).toEqual([
      "prose",
      "Matthew 6:25-27",
      "prose",
      "Matthew 6:28-30",
      "prose",
      "Matthew 6:31-34",
      "prose",
    ]);
  });

  it("treats a paragraph that is only a reference as a slot", () => {
    const blocks = composeAnswer(
      "God's Word meets worry without promising a pleasant outcome.\n\n" +
        "Matthew 6:25-34\n\n" +
        "Jesus is speaking to disciples, not issuing a formula.",
      [MATTHEW],
    );

    expect(blocks).toEqual([
      {
        type: "prose",
        text: "God's Word meets worry without promising a pleasant outcome.",
      },
      { type: "citation", reference: "Matthew 6:25-34" },
      {
        type: "prose",
        text: "Jesus is speaking to disciples, not issuing a formula.",
      },
    ]);
  });

  it("consumes a slot even when the reference has trailing punctuation", () => {
    const blocks = composeAnswer("Romans 8:28-30.", [ROMANS]);
    expect(blocks).toEqual([{ type: "citation", reference: "Romans 8:28-30" }]);
  });

  it("appends citations that the prose never names", () => {
    const blocks = composeAnswer(
      "God's Word reminds us that the Father knows what is needed.",
      [MATTHEW, PSALMS],
    );

    expect(blocks).toEqual([
      {
        type: "prose",
        text: "God's Word reminds us that the Father knows what is needed.",
      },
      { type: "citation", reference: "Matthew 6:25-34" },
      { type: "citation", reference: "Psalms 23:1-4" },
    ]);
  });

  it("returns prose only when there are no citations", () => {
    const blocks = composeAnswer("No passage is offered here.", []);
    expect(blocks).toEqual([{ type: "prose", text: "No passage is offered here." }]);
  });

  it("returns citations only when the response is empty", () => {
    const blocks = composeAnswer("  \n\n  ", [ROMANS, MATTHEW]);
    expect(blocks).toEqual([
      { type: "citation", reference: "Romans 8:28-30" },
      { type: "citation", reference: "Matthew 6:25-34" },
    ]);
  });

  it("inserts a citation only at its first mention", () => {
    const blocks = composeAnswer(
      "Matthew 6:25-34 opens the question.\n\n" +
        "Matthew 6:25-34 is worth reading slowly a second time.",
      [MATTHEW],
    );

    expect(blocks.filter((b) => b.type === "citation")).toEqual([
      { type: "citation", reference: "Matthew 6:25-34" },
    ]);
    expect(blocks).toHaveLength(3);
  });

  it("matches a narrower mention to a wider cited range", () => {
    const blocks = composeAnswer(
      "Romans 8:28 is not a promise that this will turn out well.",
      [ROMANS],
    );

    expect(blocks).toEqual([
      {
        type: "prose",
        text: "Romans 8:28 is not a promise that this will turn out well.",
      },
      { type: "citation", reference: "Romans 8:28-30" },
    ]);
  });

  it("inserts every citation named in one paragraph, in mention order", () => {
    const blocks = composeAnswer(
      "Matthew 6:25-34 and Romans 8:28-30 both refuse to treat " +
        "anxiety as something God has not already spoken to.",
      [ROMANS, MATTHEW],
    );

    expect(blocks).toEqual([
      {
        type: "prose",
        text:
          "Matthew 6:25-34 and Romans 8:28-30 both refuse to treat " +
          "anxiety as something God has not already spoken to.",
      },
      { type: "citation", reference: "Matthew 6:25-34" },
      { type: "citation", reference: "Romans 8:28-30" },
    ]);
  });

  it("ignores blank paragraphs", () => {
    const blocks = composeAnswer(
      "\n\nGod's Word reminds us of the Shepherd.\n\n\nPsalms 23:1-4\n\n",
      [PSALMS],
    );

    expect(blocks).toEqual([
      { type: "prose", text: "God's Word reminds us of the Shepherd." },
      { type: "citation", reference: "Psalms 23:1-4" },
    ]);
  });
});

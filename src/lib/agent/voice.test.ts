import { describe, expect, it } from "vitest";

import { auditVoice } from "./voice.ts";

describe("auditVoice", () => {
  it("flags speaking as God", () => {
    const phrases = [
      "I am with you in this.",
      "I'm with you in this.",
      "I have heard your prayer.",
      "I've heard your prayer.",
      "I forgive you.",
      "God wants you to know that this will pass.",
      "The Lord is telling you to wait.",
      "God is telling you to wait.",
      "I sense that this is a season of growth.",
    ];

    for (const prose of phrases) {
      expect(auditVoice(prose).length, prose).toBeGreaterThan(0);
    }
  });

  it("flags the tool speaking of itself", () => {
    const phrases = [
      "I found two passages that speak to this.",
      "I looked, but nothing fit.",
      "I think this is about provision.",
      "I hear you, and this is hard.",
      "I'm here with you.",
      "I am here with you.",
    ];

    for (const prose of phrases) {
      expect(auditVoice(prose).length, prose).toBeGreaterThan(0);
    }
  });

  it("allows Scripture-as-subject summaries and ordinary guidance", () => {
    expect(
      auditVoice(
        "God's Word reminds us that anxiety about tomorrow is met by the " +
          "Father who feeds the birds. Take this to the Lord in prayer today.",
      ),
    ).toEqual([]);
  });

  it("allows inclusive we/us without a tool I", () => {
    expect(
      auditVoice(
        "These passages show us a God who does not abandon His people in famine.",
      ),
    ).toEqual([]);
  });

  it("does not flag mentioning a psalmist or a story", () => {
    expect(
      auditVoice(
        "The psalmist's cry is honest, and Hannah's prayer at Shiloh is " +
          "the same kind of barren grief.",
      ),
    ).toEqual([]);
  });

  it("returns an actionable detail for retry", () => {
    const [problem] = auditVoice("I am with you.");
    expect(problem?.detail).toMatch(/speaks as God/i);
    expect(problem?.phrase).toBe("I am with you");
  });
});

import { describe, expect, it } from "vitest";

import { crisisResponse, detectCrisis } from "./crisis.ts";

describe("detectCrisis", () => {
  it("catches direct disclosures of suicidal intent", () => {
    const inputs = [
      "I want to kill myself",
      "I've been thinking about ending my life",
      "I don't want to be here anymore",
      "everyone would be better off without me",
      "I feel suicidal and I can't pray",
      "I wish I was dead",
      "there's no reason to go on",
    ];
    for (const input of inputs) {
      expect(detectCrisis(input)?.kind, input).toBe("self-harm");
    }
  });

  it("catches self-harm", () => {
    expect(detectCrisis("I've been cutting myself again")?.kind).toBe("self-harm");
    expect(detectCrisis("I want to hurt myself")?.kind).toBe("self-harm");
  });

  it("catches abuse disclosures", () => {
    expect(detectCrisis("my husband hits me and I'm scared")?.kind).toBe("abuse");
    expect(detectCrisis("I'm not safe at home")?.kind).toBe("abuse");
    expect(detectCrisis("I'm being abused")?.kind).toBe("abuse");
  });

  it("catches threats toward others", () => {
    expect(detectCrisis("I want to kill him")?.kind).toBe("harm-to-others");
  });

  it("detects disclosures buried inside a longer prayer", () => {
    // Real messages are rarely a single sentence.
    const prayer =
      "Father, thank You for this week and for my family. Things at work have " +
      "been hard and honestly I want to die most mornings. Please help me.";
    expect(detectCrisis(prayer)?.kind).toBe("self-harm");
  });

  it("does not fire on ordinary lament", () => {
    const ordinary = [
      "I'm exhausted and I feel like giving up on this project",
      "I'm grieving my father who died last year",
      "this season is killing me at work",
      "I feel dead inside spiritually and I want to feel alive again",
      "pray for my friend who is in the hospital",
      "I'm so angry I could scream",
    ];
    for (const input of ordinary) {
      expect(detectCrisis(input), input).toBeNull();
    }
  });

  it("does not fire on recovery or third-party framing", () => {
    expect(detectCrisis("I used to want to die but God met me")).toBeNull();
    expect(detectCrisis("how can I help a friend who is suicidal?")).toBeNull();
    expect(detectCrisis("I don't want to die, I want to live")).toBeNull();
  });

  it("ignores empty input", () => {
    expect(detectCrisis("")).toBeNull();
  });
});

describe("crisisResponse", () => {
  it("gives concrete resources for self-harm", () => {
    const text = crisisResponse({ kind: "self-harm", trigger: "want to die" });
    expect(text).toContain("988");
    expect(text).toContain("findahelpline.com");
  });

  it("gives abuse-specific resources", () => {
    const text = crisisResponse({ kind: "abuse", trigger: "hits me" });
    expect(text).toContain("1-800-799-7233");
    expect(text).toContain("None of this is your fault");
  });

  it("never cites Scripture", () => {
    // This path deliberately does not retrieve or quote. A person in crisis
    // needs a phone number, not an exposition.
    for (const kind of ["self-harm", "abuse", "harm-to-others"] as const) {
      const text = crisisResponse({ kind, trigger: "x" });
      expect(text).not.toMatch(/\b\d+:\d+\b/);
    }
  });
});

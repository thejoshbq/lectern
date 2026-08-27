/**
 * Orchestrator tests for `ask()`.
 *
 * The verification gate already has hostile-output tests. These cover the
 * pipeline around it: crisis never reaches the model, empty retrieval never
 * reaches selection, verification failures retry once, and a last attempt
 * that still fails the audits does not ship the failing fields.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.ts")>();
  return { ...actual, callStructured: vi.fn() };
});

vi.mock("../bible/retrieve.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bible/retrieve.ts")>();
  return { ...actual, retrieve: vi.fn() };
});

import { findPassageContaining } from "../bible/corpus.ts";
import { retrieve, type Candidate } from "../bible/retrieve.ts";
import { callStructured } from "./client.ts";
import { ask, type Stage } from "./pipeline.ts";
import type { Expansion, Selection } from "./schema.ts";

const structured = vi.mocked(callStructured);
const search = vi.mocked(retrieve);

const CONTEXT =
  "Paul is writing to believers in Rome, concluding an argument about " +
  "suffering in the present age and the certainty of God's purpose.";

const EXPANSION: Expansion = {
  themes: ["suffering", "God's purpose"],
  searchTerms: ["all things", "glory"],
  category: "petition",
  isSuffering: false,
};

const CLEAN_RESPONSE =
  "Romans 8:28\n\nGod's Word reminds us that suffering is not outside His purpose.";

function candidateFor(book: string, chapter: number, verse: number): Candidate {
  const passage = findPassageContaining({ book, chapter, verse });
  if (!passage) throw new Error(`No passage for ${book} ${chapter}:${verse}`);
  return {
    passage,
    score: 1,
    sources: ["lexical"],
    matchedRefs: [passage.ref],
  };
}

function cleanSelection(overrides: Partial<Selection> = {}): Selection {
  return {
    citations: [{ reference: "Romans 8:28", context: CONTEXT }],
    response: CLEAN_RESPONSE,
    ...overrides,
  };
}

function mockModels(selection: Selection | Selection[]) {
  const selections = Array.isArray(selection) ? selection : [selection];
  let selectIndex = 0;

  structured.mockImplementation(async (options) => {
    if (options.tool.name === "prepare_search") {
      return { value: EXPANSION, raw: EXPANSION };
    }

    const value = selections[Math.min(selectIndex, selections.length - 1)];
    selectIndex += 1;
    return { value, raw: value };
  });
}

function selectCalls() {
  return structured.mock.calls.filter(
    ([options]) => options.tool.name === "offer_scripture",
  );
}

describe("ask", () => {
  beforeEach(() => {
    structured.mockReset();
    search.mockReset();
    search.mockResolvedValue([candidateFor("ROM", 8, 28)]);
    mockModels(cleanSelection());
  });

  it("short-circuits crisis before retrieval or any model call", async () => {
    const stages: Stage[] = [];
    const result = await ask("I want to kill myself", {
      onStage: (stage) => stages.push(stage),
    });

    expect(result.kind).toBe("crisis");
    expect(result.citations).toEqual([]);
    expect(result.response).toContain("988");
    expect(search).not.toHaveBeenCalled();
    expect(structured).not.toHaveBeenCalled();
    expect(stages).toEqual(["checking"]);
  });

  it("does not call the selection model when retrieval is empty", async () => {
    search.mockResolvedValue([]);

    const stages: Stage[] = [];
    const result = await ask("I'd like to pray about this", {
      onStage: (stage) => stages.push(stage),
    });

    expect(result.kind).toBe("answer");
    expect(result.noRelevantScripture).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.response).toMatch(/No passages were found/);
    expect(selectCalls()).toHaveLength(0);
    expect(stages).toEqual(["checking", "understanding", "searching"]);
  });

  it("returns verified citations and clean prose on the first attempt", async () => {
    const stages: Stage[] = [];
    const result = await ask("I'd like to pray through suffering", {
      onStage: (stage) => stages.push(stage),
    });

    expect(result.kind).toBe("answer");
    expect(result.response).toBe(CLEAN_RESPONSE);
    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);
    expect(result.citations[0].verses[0].text).toContain(
      "God works all things together",
    );
    expect(result.diagnostics.attempts).toBe(1);
    expect(selectCalls()).toHaveLength(1);
    expect(stages).toEqual([
      "checking",
      "understanding",
      "searching",
      "reading",
      "verifying",
      "done",
    ]);
  });

  it("retries selection once when verification fails, then ships the correction", async () => {
    mockModels([
      cleanSelection({
        citations: [{ reference: "Hezekiah 3:16", context: CONTEXT }],
      }),
      cleanSelection(),
    ]);

    const result = await ask("I'd like to pray through suffering");

    expect(selectCalls()).toHaveLength(2);
    expect(result.diagnostics.attempts).toBe(2);
    expect(result.response).toBe(CLEAN_RESPONSE);
    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);

    const retryMessages = selectCalls()[1][0].messages;
    expect(retryMessages.some((message) => message.role === "tool")).toBe(true);
  });

  it("strips last-attempt prose that smuggles an uncited reference", async () => {
    mockModels([
      cleanSelection({
        response:
          "Take heart — as it says in Jeremiah 29:11, God has plans to prosper you.\n\nRomans 8:28",
      }),
      cleanSelection({
        response:
          "Take heart — as it says in Jeremiah 29:11, God has plans to prosper you.\n\nRomans 8:28",
      }),
    ]);

    const result = await ask("I'd like to pray through suffering");

    expect(selectCalls()).toHaveLength(2);
    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);
    expect(result.response).toBe("");
    expect(result.response).not.toContain("Jeremiah 29:11");
  });

  it("strips last-attempt voice from prayer without dropping a clean summary", async () => {
    mockModels([
      cleanSelection({ prayer: "I found this way to pray these verses." }),
      cleanSelection({ prayer: "I found this way to pray these verses." }),
    ]);

    const result = await ask("I'd like to pray through suffering");

    expect(result.response).toBe(CLEAN_RESPONSE);
    expect(result.prayer).toBeUndefined();
    expect(result.citations).toHaveLength(1);
  });

  it("strips a last-attempt misquotation while keeping the verified citation", async () => {
    mockModels([
      cleanSelection({
        response:
          'Scripture says, "The Lord is my shepherd, I shall not want for anything at all."',
      }),
      cleanSelection({
        response:
          'Scripture says, "The Lord is my shepherd, I shall not want for anything at all."',
      }),
    ]);

    const result = await ask("I'd like to pray through suffering");

    expect(result.citations.map((c) => c.reference)).toEqual(["Romans 8:28"]);
    expect(result.response).toBe("");
    expect(result.response).not.toContain("shepherd");
  });

  it("keeps clean last-attempt prose when only the citation failed", async () => {
    const proseWithoutAReference =
      "God's Word reminds us that suffering is not outside His purpose.";

    mockModels([
      cleanSelection({
        citations: [{ reference: "Hezekiah 3:16", context: CONTEXT }],
        response: proseWithoutAReference,
      }),
      cleanSelection({
        citations: [{ reference: "Hezekiah 3:16", context: CONTEXT }],
        response: proseWithoutAReference,
      }),
    ]);

    const result = await ask("I'd like to pray through suffering");

    expect(result.citations).toEqual([]);
    expect(result.noRelevantScripture).toBe(true);
    expect(result.response).toBe(proseWithoutAReference);
    expect(result.diagnostics.rejections.some((r) => r.reason === "unparseable")).toBe(
      true,
    );
  });
});

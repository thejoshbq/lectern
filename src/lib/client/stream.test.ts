import { describe, expect, it } from "vitest";

import { finishNdjson, takeNdjsonLines } from "./stream.ts";

describe("takeNdjsonLines", () => {
  it("yields complete lines and keeps the partial tail", () => {
    expect(takeNdjsonLines('{"type":"stage"}\n{"type":"res')).toEqual({
      lines: ['{"type":"stage"}'],
      rest: '{"type":"res',
    });
  });

  it("splits chunked lines across pushes", () => {
    const first = takeNdjsonLines('{"a":1}\n{"b":');
    expect(first.lines).toEqual(['{"a":1}']);
    const second = takeNdjsonLines(first.rest + '2}\n{"c":3}\n');
    expect(second.lines).toEqual(['{"b":2}', '{"c":3}']);
    expect(second.rest).toBe("");
  });

  it("drops blank lines between events", () => {
    expect(takeNdjsonLines('{"a":1}\n\n{"b":2}\n')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: "",
    });
  });
});

describe("finishNdjson", () => {
  it("emits a leftover result line that has no trailing newline", () => {
    expect(finishNdjson('{"type":"result","result":{"kind":"answer"}}')).toEqual([
      '{"type":"result","result":{"kind":"answer"}}',
    ]);
  });

  it("returns nothing for an empty leftover buffer", () => {
    expect(finishNdjson("")).toEqual([]);
    expect(finishNdjson("   \n")).toEqual([]);
  });

  it("flushes the rest after takeNdjsonLines on stream end", () => {
    const { lines, rest } = takeNdjsonLines(
      '{"type":"stage","stage":"done"}\n{"type":"result","result":{}}',
    );
    expect(lines).toEqual(['{"type":"stage","stage":"done"}']);
    expect(finishNdjson(rest)).toEqual(['{"type":"result","result":{}}']);
  });
});

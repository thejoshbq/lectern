/**
 * NDJSON framing for the /api/ask stream.
 *
 * Events are one JSON object per line. The last event may arrive without a
 * trailing newline, so callers must flush the leftover buffer when the
 * stream ends rather than dropping it.
 */

export function takeNdjsonLines(buffer: string): {
  lines: string[];
  rest: string;
} {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return {
    lines: parts.filter((line) => line.trim().length > 0),
    rest,
  };
}

/** Remaining buffer when the stream ends, including a last line with no newline. */
export function finishNdjson(rest: string): string[] {
  const trimmed = rest.trim();
  return trimmed ? [trimmed] : [];
}

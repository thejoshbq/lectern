/**
 * Command-line harness for the full pipeline.
 *
 * Exists so the retrieval and verification layers can be exercised and judged
 * before any interface is built on top of them — and so that retrieval quality
 * can be inspected without an API key at all.
 *
 * Usage:
 *   npm run lectern -- "I'm anxious about money"
 *   npm run lectern -- --retrieval-only "I'm grieving my father"
 *   npm run lectern -- --diagnostics "why does God feel absent"
 *   echo "..." | npm run lectern
 */

import { ask, type Stage } from "../src/lib/agent/pipeline.ts";
import { getCorpusInfo, getPassageVerses } from "../src/lib/bible/corpus.ts";
import { retrieve } from "../src/lib/bible/retrieve.ts";
import type { VerifiedCitation } from "../src/lib/bible/verify.ts";
import { composeAnswer } from "../src/lib/client/compose.ts";
import { loadEnv } from "../src/lib/env.ts";

loadEnv();

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const style = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  gold: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  italic: (s: string) => (useColor ? `\x1b[3m${s}\x1b[0m` : s),
};

function wrap(text: string, width = 76, indent = ""): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

function printCitation(citation: VerifiedCitation) {
  console.log(style.gold(style.bold(citation.reference)));
  if (citation.passage.heading) {
    console.log(style.dim(`${citation.passage.heading} · ${citation.genre}`));
  }
  for (const verse of citation.verses) {
    console.log(style.italic(wrap(`${verse.verse} ${verse.text}`, 72, "  ")));
  }
  console.log(style.dim(wrap(`Context: ${citation.context}`, 72, "  ")));
  console.log("");
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const args = process.argv.slice(2);
  const retrievalOnly = args.includes("--retrieval-only");
  const showDiagnostics = args.includes("--diagnostics") || retrievalOnly;

  const text =
    args.filter((a) => !a.startsWith("--")).join(" ").trim() ||
    (await readStdin());

  if (!text) {
    console.error(
      "Usage: npm run lectern -- \"I'd like to pray for...\"\n" +
        "       npm run lectern -- --retrieval-only \"...\"   (no API key needed)\n" +
        "       npm run lectern -- --diagnostics \"...\"",
    );
    process.exit(1);
  }

  const info = getCorpusInfo();
  console.log(
    style.dim(
      `${info.translationName} ${info.release} · ${info.verseCount} verses · ` +
        `${info.passageCount} passages · ` +
        (info.hasVectors && info.embeddingModel
          ? `dense retrieval via ${info.embeddingModel}`
          : "lexical retrieval only"),
    ),
  );
  console.log("");

  if (retrievalOnly) {
    const candidates = await retrieve({ text, limit: 12 });
    console.log(style.bold("Retrieved passages"));
    console.log("");
    for (const [i, c] of candidates.entries()) {
      const heading = c.passage.heading ? ` — ${c.passage.heading}` : "";
      console.log(
        `${String(i + 1).padStart(2)}. ${style.gold(c.passage.ref)}${style.dim(heading)}`,
      );
      console.log(
        style.dim(
          `    ${c.passage.genre} · score ${c.score.toFixed(4)} · ${c.sources.join(", ")}`,
        ),
      );
      const preview = getPassageVerses(c.passage.id)
        .map((v) => v.text)
        .join(" ")
        .slice(0, 180);
      console.log(style.italic(wrap(preview + "...", 72, "    ")));
      console.log("");
    }
    return;
  }

  const labels: Record<Stage, string> = {
    checking: "checking",
    understanding: "understanding the request",
    searching: "searching Scripture",
    reading: "reading the passages",
    verifying: "verifying citations",
    done: "done",
  };

  const result = await ask(text, {
    onStage: (stage) => {
      if (process.stdout.isTTY && stage !== "done") {
        process.stdout.write(`\r${style.dim("… " + labels[stage].padEnd(30))}`);
      }
    },
  });

  if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(34) + "\r");

  if (result.kind === "crisis") {
    console.log(style.red(style.bold("Crisis path — no model call, no retrieval")));
    console.log("");
    console.log(result.response);
    console.log("");
    return;
  }

  console.log("");

  if (result.noRelevantScripture && result.citations.length === 0) {
    console.log(
      style.dim("No passage was offered — nothing retrieved genuinely fit."),
    );
    console.log("");
  }

  const byReference = new Map(
    result.citations.map((citation) => [citation.reference, citation]),
  );

  for (const block of composeAnswer(result.response, result.citations)) {
    if (block.type === "prose") {
      console.log(wrap(block.text));
      console.log("");
      continue;
    }

    const citation = byReference.get(block.reference);
    if (citation) printCitation(citation);
  }

  if (result.correction) {
    console.log(style.bold("A gentle word"));
    console.log(wrap(result.correction));
    console.log("");
  }

  if (result.prayer) {
    console.log(style.bold("How to pray"));
    console.log(style.cyan(wrap(result.prayer)));
    console.log("");
  }

  if (result.triageNote) {
    console.log(style.dim(wrap(result.triageNote)));
    console.log("");
  }

  if (showDiagnostics) {
    const d = result.diagnostics;
    console.log(style.dim("─".repeat(72)));
    console.log(style.dim(`themes:      ${d.expansion?.themes.join(", ") ?? "-"}`));
    console.log(style.dim(`terms:       ${d.expansion?.searchTerms.join(", ") ?? "-"}`));
    console.log(
      style.dim(
        `category:    ${d.expansion?.category ?? "-"} · suffering: ${d.expansion?.isSuffering ?? "-"}`,
      ),
    );
    console.log(
      style.dim(
        `retrieved:   ${d.candidateCount} passages · dense: ${d.denseRetrieval}`,
      ),
    );
    console.log(style.dim(`attempts:    ${d.attempts}`));
    console.log(style.dim(`elapsed:     ${(d.elapsedMs / 1000).toFixed(1)}s`));
    if (d.rejections.length) {
      console.log(style.red(`rejected:    ${d.rejections.length} citation(s)`));
      for (const r of d.rejections) {
        console.log(style.red(`  ${r.reference} [${r.reason}]`));
      }
    }
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});

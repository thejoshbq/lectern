/**
 * Evaluation runner.
 *
 * Retrieval evaluation runs offline and needs no API key: it asks whether
 * searching for a real human request surfaces passages that actually address
 * it, and whether keyword-only matches (the genealogy that matched "father"
 * and "died") are being kept out.
 *
 * Adversarial evaluation exercises the whole pipeline and does need a key. It
 * reports what the system did with requests designed to draw out mishandling,
 * for a human to read. It does not grade itself — whether a response handled
 * Jeremiah 29:11 rightly is a judgment call, and pretending otherwise would
 * produce a number that means nothing.
 *
 * Usage:
 *   npm run evals                 # retrieval only, no key needed
 *   npm run evals -- --adversarial
 *   npm run evals -- --verbose
 */

import { ADVERSARIAL_CASES, RETRIEVAL_CASES } from "../evals/cases.ts";
import { ask } from "../src/lib/agent/pipeline.ts";
import { getCorpusInfo } from "../src/lib/bible/corpus.ts";
import { parseReference, rangeStartKey } from "../src/lib/bible/reference.ts";
import { retrieve } from "../src/lib/bible/retrieve.ts";
import { loadEnv } from "../src/lib/env.ts";

loadEnv();

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);

const DEFAULT_TOP_K = 10;

/** True when a retrieved passage contains the reference we hoped to see. */
function passageCovers(
  passage: { book: string; startKey: number; endKey: number },
  reference: string,
): boolean {
  const range = parseReference(reference);
  if (!range) return false;
  if (range.book !== passage.book) return false;
  const key = rangeStartKey(range);
  return passage.startKey <= key && key <= passage.endKey;
}

async function runRetrievalEvals(verbose: boolean): Promise<boolean> {
  console.log(bold("Retrieval"));
  console.log("");

  let passed = 0;
  let contaminated = 0;
  let knownGaps = 0;
  let regressions = 0;
  const fixedGaps: string[] = [];
  const ranks: number[] = [];

  for (const testCase of RETRIEVAL_CASES) {
    const topK = testCase.topK ?? DEFAULT_TOP_K;
    const candidates = await retrieve({ text: testCase.request, limit: topK });

    let hitIndex = -1;
    let hitRef = "";

    for (const [i, candidate] of candidates.entries()) {
      const match = testCase.expectAnyOf.find((ref) =>
        passageCovers(candidate.passage, ref),
      );
      if (match) {
        hitIndex = i;
        hitRef = match;
        break;
      }
    }

    const unwanted = (testCase.expectNoneOf ?? []).filter((ref) =>
      candidates.some((c) => passageCovers(c.passage, ref)),
    );

    const ok = hitIndex >= 0 && unwanted.length === 0;
    if (ok) passed++;
    if (unwanted.length > 0) contaminated++;
    if (hitIndex >= 0) ranks.push(hitIndex + 1);

    // A known gap that fails is expected. A known gap that passes means the
    // limitation was fixed and the annotation is now lying about the system.
    const gap = testCase.knownGap;
    if (gap && !ok) knownGaps++;
    if (gap && ok) {
      fixedGaps.push(testCase.name);
      regressions++;
    }
    if (!gap && !ok) regressions++;

    const status = ok
      ? gap
        ? yellow("FIXED")
        : green("pass")
      : gap
        ? yellow("gap")
        : red("FAIL");

    const detail =
      hitIndex >= 0
        ? dim(`found ${hitRef} at rank ${hitIndex + 1}`)
        : gap
          ? dim("known gap — " + gap.split(".")[0])
          : red("no expected passage in top " + topK);

    console.log(`  ${status}  ${testCase.name.padEnd(34)} ${detail}`);

    if (unwanted.length > 0) {
      console.log(
        red(`        keyword-only matches present: ${unwanted.join(", ")}`),
      );
    }

    if (verbose || !ok) {
      for (const [i, candidate] of candidates.slice(0, 5).entries()) {
        console.log(
          dim(
            `        ${i + 1}. ${candidate.passage.ref} — ` +
              `${candidate.passage.heading ?? ""} [${candidate.sources.join(",")}]`,
          ),
        );
      }
    }
  }

  const meanRank = ranks.length
    ? (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1)
    : "n/a";

  console.log("");
  console.log(
    `  ${passed}/${RETRIEVAL_CASES.length} passed · mean rank of first hit ${meanRank}` +
      (knownGaps ? dim(` · ${knownGaps} known gaps`) : "") +
      (contaminated ? red(` · ${contaminated} contaminated by keyword matches`) : ""),
  );

  for (const name of fixedGaps) {
    console.log(
      yellow(
        `  "${name}" now passes. Remove its knownGap annotation — the file is ` +
          `describing a weakness the system no longer has.`,
      ),
    );
  }

  console.log("");

  return regressions === 0;
}

async function runAdversarialEvals(): Promise<void> {
  console.log(bold("Adversarial (full pipeline)"));
  console.log("");
  console.log(
    dim(
      "  These are reported for a human to judge, not auto-graded. Read what\n" +
        "  the system actually said and whether it handled the concern rightly.\n",
    ),
  );

  for (const testCase of ADVERSARIAL_CASES) {
    console.log(bold(`  ${testCase.name}`));
    console.log(dim(`  request: ${testCase.request}`));
    console.log(dim(`  concern: ${testCase.concern}`));

    try {
      const result = await ask(testCase.request);

      console.log(`  response: ${result.response.replace(/\n+/g, " ").slice(0, 400)}`);
      console.log(
        `  cited:    ${
          result.citations.map((c) => c.reference).join(", ") || "(nothing)"
        }`,
      );

      if (result.kind === "crisis") {
        console.log(green("  crisis path taken"));
      }
      if (result.noRelevantScripture) {
        console.log(dim("  declined to cite"));
      }
      if (result.correction) {
        console.log(`  correction: ${result.correction.slice(0, 200)}`);
      }
      if (result.diagnostics.rejections.length) {
        console.log(
          dim(
            `  gate rejected: ${result.diagnostics.rejections
              .map((r) => `${r.reference} [${r.reason}]`)
              .join(", ")}`,
          ),
        );
      }
    } catch (err) {
      console.log(red(`  error: ${(err as Error).message}`));
    }

    console.log("");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const adversarial = args.includes("--adversarial");

  const info = getCorpusInfo();
  console.log(
    dim(
      `${info.translationName} ${info.release} · ` +
        (info.hasVectors && info.embeddingModel
          ? `dense retrieval via ${info.embeddingModel}`
          : "lexical retrieval only — expect weaker results"),
    ),
  );
  console.log("");

  const retrievalOk = await runRetrievalEvals(verbose);

  if (adversarial) {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error(
        red("Adversarial evals need OPENROUTER_API_KEY (they run the full pipeline)."),
      );
      process.exit(1);
    }
    await runAdversarialEvals();
  }

  if (!retrievalOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

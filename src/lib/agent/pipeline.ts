/**
 * The request pipeline.
 *
 *   crisis check → expand → retrieve → select → verify → render
 *
 * Every stage before `select` narrows what the model is allowed to say, and
 * every stage after it checks what the model actually said. The model's role
 * is judgment about relevance and context; it is never the source of Scripture
 * text, and never the final authority on whether its own citations are valid.
 */

import { getPassageVerses, type Verse } from "../bible/corpus.ts";
import { retrieve } from "../bible/retrieve.ts";
import {
  auditProse,
  auditQuotations,
  verifyCitations,
  type VerifiedCitation,
} from "../bible/verify.ts";
import { auditVoice } from "./voice.ts";
import {
  callStructured,
  toolRetryTurns,
  userMessage,
  MODEL_EXPAND,
  MODEL_SELECT,
  type ChatMessage,
} from "./client.ts";
import { crisisResponse, detectCrisis, type CrisisMatch } from "./crisis.ts";
import {
  EXPANSION_SYSTEM,
  expansionUserMessage,
  formatCandidates,
  retryMessage,
  selectionSystem,
  selectionUserMessage,
} from "./prompts.ts";
import {
  EXPANSION_TOOL,
  expansionSchema,
  SELECTION_TOOL,
  selectionSchema,
  type Expansion,
  type Selection,
} from "./schema.ts";
import type { Stage } from "./wire.ts";

export type { Stage };

export interface AskOptions {
  /** Prior turns, oldest first. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Number of passages retrieved. */
  retrievalLimit?: number;
  /** Number of passages actually shown to the model. */
  candidateLimit?: number;
  /** Reports stage transitions, for streaming progress to the UI. */
  onStage?: (stage: Stage) => void;
}

export interface AskResult {
  kind: "answer" | "crisis";
  /** Prose written by the model, with no Scripture text in it. */
  response: string;
  citations: VerifiedCitation[];
  prayer?: string;
  correction?: string;
  triageNote?: string;
  noRelevantScripture: boolean;
  crisis?: CrisisMatch;
  diagnostics: Diagnostics;
}

export interface Diagnostics {
  expansion?: Expansion;
  candidateCount: number;
  retrievedRefs: string[];
  attempts: number;
  /** Citations the verifier refused, with the reason. Never shown to users. */
  rejections: { reference: string; reason: string; detail: string }[];
  denseRetrieval: boolean;
  elapsedMs: number;
}

const DEFAULT_RETRIEVAL_LIMIT = 40;
const DEFAULT_CANDIDATE_LIMIT = 22;
const MAX_ATTEMPTS = 2;

export async function ask(text: string, options: AskOptions = {}): Promise<AskResult> {
  const started = Date.now();
  const report = options.onStage ?? (() => {});

  report("checking");

  // Crisis handling runs first and does not reach the model. See crisis.ts for
  // why this path is deliberately not generated.
  const crisis = detectCrisis(text);
  if (crisis) {
    return {
      kind: "crisis",
      response: crisisResponse(crisis),
      citations: [],
      noRelevantScripture: false,
      crisis,
      diagnostics: {
        candidateCount: 0,
        retrievedRefs: [],
        attempts: 0,
        rejections: [],
        denseRetrieval: false,
        elapsedMs: Date.now() - started,
      },
    };
  }

  // Stage 1: work out what to search for. Raw prayer text is poor search
  // input — "my father died" matches genealogies — so the request is
  // translated into the vocabulary Scripture actually uses.
  report("understanding");
  const expansion = await expandQuery(text);

  // Stage 2: retrieve whole passages, never loose verses.
  report("searching");
  const candidates = await retrieve({
    text,
    expansions: [...expansion.searchTerms, ...expansion.themes],
    limit: options.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT,
  });

  const shown = candidates.slice(0, options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT);
  const allowedPassageIds = new Set(shown.map((c) => c.passage.id));

  const diagnostics: Diagnostics = {
    expansion,
    candidateCount: shown.length,
    retrievedRefs: shown.map((c) => c.passage.ref),
    attempts: 0,
    rejections: [],
    denseRetrieval: shown.some((c) => c.sources.includes("dense")),
    elapsedMs: 0,
  };

  if (shown.length === 0) {
    return {
      kind: "answer",
      response:
        "No passages were found that speak directly to this. " +
        "That may mean the request was misunderstood — trying another wording " +
        "will search again.",
      citations: [],
      noRelevantScripture: true,
      diagnostics: { ...diagnostics, elapsedMs: Date.now() - started },
    };
  }

  // Stage 3: the model reads the passages in context and chooses.
  report("reading");

  const versesByPassage = new Map<number, Verse[]>();
  const versesFor = (passageId: number) => {
    let verses = versesByPassage.get(passageId);
    if (!verses) {
      verses = getPassageVerses(passageId);
      versesByPassage.set(passageId, verses);
    }
    return verses;
  };

  const messages: ChatMessage[] = [
    userMessage(
      selectionUserMessage({
        request: text,
        candidates: formatCandidates(shown, versesFor),
        themes: expansion.themes,
        category: expansion.category,
        isSuffering: expansion.isSuffering,
        history: options.history,
      }),
    ),
  ];

  let selection: Selection | null = null;
  let verified: VerifiedCitation[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    diagnostics.attempts = attempt;

    const { value, raw } = await callStructured({
      model: MODEL_SELECT,
      system: selectionSystem(),
      messages,
      tool: SELECTION_TOOL,
      schema: selectionSchema,
      maxTokens: 8192,
    });

    selection = value;

    // Stage 4: check the model's work.
    report("verifying");

    const result = verifyCitations(
      value.citations.map((c) => ({
        reference: c.reference,
        context: c.context,
        relevance: c.relevance,
      })),
      { allowedPassageIds },
    );

    const combinedProse = [value.response, value.prayer, value.correction]
      .filter(Boolean)
      .join("\n\n");
    const proseProblems = auditProse(combinedProse, result.citations);
    const quotationProblems = auditQuotations(combinedProse, result.citations);
    const voiceProblems = auditVoice(combinedProse);

    diagnostics.rejections.push(
      ...result.rejections.map((r) => ({
        reference: r.reference,
        reason: r.reason,
        detail: r.detail,
      })),
    );

    const problems = [
      ...result.rejections.map((r) => r.detail),
      ...proseProblems.map((p) => p.detail),
      ...quotationProblems.map((p) => p.detail),
      ...voiceProblems.map((p) => p.detail),
    ];

    verified = result.citations;

    // Retry once with the failures so the model can correct a specific
    // citation rather than starting over. After the last attempt, fields
    // that still fail the audits are dropped below rather than shipped.
    if (problems.length === 0 || attempt === MAX_ATTEMPTS) break;

    messages.push(
      ...toolRetryTurns(SELECTION_TOOL.name, raw, retryMessage(problems)),
    );
  }

  report("done");

  const noRelevant =
    selection?.noRelevantScripture === true || verified.length === 0;

  // Citations that failed verification were never added to `verified`.
  // Prose, prayer, and correction are withheld the same way: a field that
  // still fails the audits after the last attempt does not ship.
  return {
    kind: "answer",
    response: keepAuditedText(selection?.response, verified) ?? "",
    citations: verified,
    prayer: keepAuditedText(selection?.prayer, verified),
    correction: keepAuditedText(selection?.correction, verified),
    triageNote: selection?.triageNote,
    noRelevantScripture: noRelevant,
    diagnostics: { ...diagnostics, elapsedMs: Date.now() - started },
  };
}

/**
 * A model field ships only when the same audits that reject citations also
 * pass. Retry uses those problems as feedback; this is the last-attempt strip.
 */
function keepAuditedText(
  text: string | undefined,
  verified: VerifiedCitation[],
): string | undefined {
  if (!text) return undefined;

  const problems = [
    ...auditProse(text, verified),
    ...auditQuotations(text, verified),
    ...auditVoice(text),
  ];

  return problems.length === 0 ? text : undefined;
}

async function expandQuery(text: string): Promise<Expansion> {
  try {
    const { value } = await callStructured({
      model: MODEL_EXPAND,
      system: EXPANSION_SYSTEM,
      messages: [userMessage(expansionUserMessage(text))],
      tool: EXPANSION_TOOL,
      schema: expansionSchema,
      maxTokens: 1024,
    });
    return value;
  } catch {
    // Expansion is an optimization. If it fails, retrieval still runs on the
    // user's own words rather than the whole request failing.
    return {
      themes: [],
      searchTerms: [],
      category: "other",
      isSuffering: false,
    };
  }
}

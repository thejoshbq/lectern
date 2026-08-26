/**
 * System prompt assembly.
 *
 * The doctrinal content lives in docs/ as prose and is compiled in here. That
 * indirection is deliberate: the theology governing this tool should be
 * reviewable, diffable, and arguable as a document, not scattered through
 * template literals where nobody will ever read it as a whole.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Candidate } from "../bible/retrieve.ts";

const DOCTRINE_FILES = [
  "hermeneutics.md",
  "triage.md",
  "guardrails.md",
] as const;

let cachedDocs: string | null = null;

function loadDoctrine(): string {
  if (cachedDocs) return cachedDocs;

  const parts: string[] = [];
  for (const name of DOCTRINE_FILES) {
    try {
      parts.push(readFileSync(join(process.cwd(), "docs", name), "utf8").trim());
    } catch {
      throw new Error(
        `Missing doctrinal document docs/${name}. ` +
          `These files define how the agent handles Scripture and are required.`,
      );
    }
  }

  cachedDocs = parts.join("\n\n---\n\n");
  return cachedDocs;
}

/** Test seam for reloading edited docs without restarting. */
export function resetDoctrineCache(): void {
  cachedDocs = null;
}

// ---------------------------------------------------------------------------
// Query expansion
// ---------------------------------------------------------------------------

export const EXPANSION_SYSTEM = `You prepare search queries for a Bible retrieval system.

A person has written a prayer, a request, or a question. The prayer may be addressed to God in the second person — "Father, You know the rent is due." "You" is God, not this tool. Extract the situation and the need. Do not treat the prayer as a message to Lectern. You are not answering them and you are not offering comfort. You are producing search input.

The retrieval system uses both keyword and semantic search over the Berean Standard Bible, so give it two kinds of help:

- Biblical vocabulary: the words Scripture itself uses for this situation. Someone writing "I'm broke and terrified about rent" needs terms like "provision", "daily bread", "anxious", "storehouse", "the birds of the air" — not "rent" or "budget".
- Themes, concepts, and stories: what is actually going on theologically, and, when they genuinely map, the names of biblical figures and scenes. Grief, doubt, guilt, envy, gratitude, fear of death, longing for justice, the silence of God. Job's lament, Hannah's barrenness, Joseph in prison, the disciples in the storm — only when the story actually bears on the situation, never forced.

Be careful to identify what is really being asked. A person saying "please make my boss stop favouring my coworker" may be asking about envy, or about injustice, or about contentment, and the right passages differ. Include the plausible readings rather than picking one.

Judge whether the person is suffering right now. This gates whether correction is appropriate later, so weigh it seriously: acute grief, fear, crisis, or despair means yes. General frustration or a doctrinal question means no.`;

export function expansionUserMessage(text: string): string {
  return `Here is what the person wrote:\n\n<request>\n${text}\n</request>`;
}

// ---------------------------------------------------------------------------
// Passage selection and response
// ---------------------------------------------------------------------------

export function selectionSystem(): string {
  return `You are Lectern, a tool that helps Christians pray with Scripture.

What they wrote may be a prayer addressed to God, a request, a lament, or a question. You are not the addressee. You have been given passages retrieved from the Berean Standard Bible. Your task is to choose the ones that genuinely speak to what they have brought, and to help them pray those passages themselves.

## How this system works, and why it constrains you

You do not quote Scripture. You cite it by reference, and the application renders the verse text from its own copy of the Bible into the response, where you name each passage. This is not a stylistic preference: any reference you invent will fail to resolve and be discarded, and any passage you cite that was not among those provided will be refused. Work within that.

Three rules follow:

1. **Cite only from the passages provided below.** They were retrieved for this request and their full context is in front of you. A verse you recall from memory is not available to you here, however apt it seems.
2. **Do not quote verse text in your prose.** Refer to passages by reference. The application inserts the verse text where you name the passage.
3. **Every citation must carry an account of its context** — what the passage is saying, to whom, and in what situation. A citation without this is refused by the system. This exists because a verse handed over without its context is the single most common way Scripture gets misused, and it is the thing this tool is built to prevent.

## Choosing well

Relevance means the passage actually addresses the matter in its own context. It does not mean the passage contains a matching word. If retrieval surfaced a genealogy because it happened to contain "father" and "died", do not use it.

Two or three passages received well are worth more than six skimmed. Prefer fewer, better-fitting passages. If a narrative, gospel scene, or historical account in the candidate set genuinely addresses the matter, include it among those few: give the story's own situation, then why it bears on this prayer. Do not force a story that does not fit, and do not allegorize. If nothing genuinely fits, say so plainly and set noRelevantScripture — that is a valid and honest outcome, and far better than pressing an ill-fitting text into service.

Attend to the genre label on each passage. It tells you how the passage functions and therefore how it may be used.

## Your response

Write in the register of "God's Word reminds us that…" — Scripture as the subject, not Lectern as a friend answering a request. Warm and plain. Not a preacher. Not a therapist. Not God.

Turn to each cited passage in turn. Name it by reference — a reference on its own line is best — and the application will render the verse text there from its own copy of the Bible. Then say why that Word bears on what they brought. Do not restate the verses. Do not quote verse text. Be brief. Leave room for them to actually pray.

In the prayer field, do not write a prayer for them to copy. Prompt how to pray the passages you cited: what to name before God, what to ask, what to leave with Him. Instruction, not a script. Never in their voice. Never in God's.

Never speak as God. Never speak as this tool ("I found", "I hear you", "I'm here"). Never say what God is telling them, wants for them, or is doing in their circumstances. Scripture speaks; you report what it says.

---

${loadDoctrine()}`;
}

/**
 * Renders retrieved passages for the model.
 *
 * Verse numbers are included so citations can be precise, and long passages
 * are windowed around what matched so that the model never cites text it was
 * not actually shown.
 */
export function formatCandidates(
  candidates: Candidate[],
  versesFor: (passageId: number) => { verse: number; chapter: number; text: string }[],
  maxVersesPerPassage = 30,
): string {
  const blocks: string[] = [];

  for (const candidate of candidates) {
    const { passage } = candidate;
    let verses = versesFor(passage.id);
    let truncationNote = "";

    if (verses.length > maxVersesPerPassage) {
      // Centre the window on whatever matched, so the relevant part survives.
      const matchedVerseNumbers = candidate.matchedRefs
        .map((ref) => /(\d+):(\d+)$/.exec(ref))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[2]));

      const focus = matchedVerseNumbers.length
        ? verses.findIndex((v) => v.verse === matchedVerseNumbers[0])
        : 0;

      const start = Math.max(
        0,
        Math.min(
          (focus < 0 ? 0 : focus) - Math.floor(maxVersesPerPassage / 2),
          verses.length - maxVersesPerPassage,
        ),
      );

      const window = verses.slice(start, start + maxVersesPerPassage);
      truncationNote = ` [showing verses ${window[0].chapter}:${window[0].verse}-${window[window.length - 1].chapter}:${window[window.length - 1].verse} of a longer passage; cite only from what is shown]`;
      verses = window;
    }

    const heading = passage.heading ? ` — "${passage.heading}"` : "";
    const lines = verses.map((v) => `${v.chapter}:${v.verse} ${v.text}`).join("\n");

    blocks.push(
      `<passage id="${passage.id}" ref="${passage.ref}" genre="${passage.genre}" testament="${passage.testament}">\n` +
        `${passage.ref}${heading}${truncationNote}\n${lines}\n</passage>`,
    );
  }

  return blocks.join("\n\n");
}

export interface SelectionContext {
  request: string;
  candidates: string;
  themes: string[];
  category: string;
  isSuffering: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
}

export function selectionUserMessage(context: SelectionContext): string {
  const parts: string[] = [];

  if (context.history?.length) {
    const transcript = context.history
      .map((m) => `${m.role === "user" ? "Them" : "You"}: ${m.content}`)
      .join("\n\n");
    parts.push(`<conversation-so-far>\n${transcript}\n</conversation-so-far>`);
  }

  parts.push(`<request>\n${context.request}\n</request>`);

  parts.push(
    `<assessment>\n` +
      `Kind of prayer: ${context.category}\n` +
      `Themes identified: ${context.themes.join(", ") || "none identified"}\n` +
      `This person appears to be suffering right now: ${context.isSuffering ? "yes" : "no"}\n` +
      `</assessment>`,
  );

  if (context.isSuffering) {
    parts.push(
      `This person is in distress. Meet them where Scripture meets sufferers — ` +
        `alongside them, not above them. Do not correct, instruct, or find the ` +
        `lesson in their suffering. Comfort comes first, and today it may be all ` +
        `there is room for.`,
    );
  }

  parts.push(
    `<retrieved-passages>\n${context.candidates}\n</retrieved-passages>\n\n` +
      `These are the only passages you may cite.`,
  );

  return parts.join("\n\n");
}

/** Feedback appended on retry when verification rejected citations. */
export function retryMessage(problems: string[]): string {
  return (
    `Your previous response was rejected by the checker:\n\n` +
    problems.map((p) => `- ${p}`).join("\n") +
    `\n\nRevise and answer again. Cite only passages from the list you were ` +
    `given, give each one its context, do not quote verse text in your prose ` +
    `(name the passage by reference so its text can be shown there), ` +
    `and do not speak as God or as this tool.`
  );
}

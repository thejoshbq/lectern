/**
 * Structured output contracts for the two model calls.
 *
 * Each is expressed twice: as a JSON Schema, which is what the Claude tool-use
 * API consumes, and as a Zod schema, which validates what comes back. The
 * model is instructed and constrained, but never trusted — a malformed or
 * surprising payload is caught here rather than three layers downstream.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Query expansion
// ---------------------------------------------------------------------------

export const PRAYER_CATEGORIES = [
  "lament",
  "petition",
  "intercession",
  "confession",
  "thanksgiving",
  "praise",
  "question",
  "other",
] as const;

export const expansionSchema = z.object({
  themes: z.array(z.string()).min(1).max(8),
  searchTerms: z.array(z.string()).min(1).max(20),
  category: z.enum(PRAYER_CATEGORIES),
  isSuffering: z.boolean(),
  reading: z.string().optional(),
});

export type Expansion = z.infer<typeof expansionSchema>;

export const EXPANSION_TOOL = {
  name: "prepare_search",
  description:
    "Record the themes and search terms to use when searching Scripture for this request.",
  input_schema: {
    type: "object" as const,
    properties: {
      themes: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 8,
        description:
          "Theological and biblical themes at work, e.g. 'grief', 'the silence of God', 'envy', 'God's provision'.",
      },
      searchTerms: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 20,
        description:
          "Words and short phrases likely to appear in the Bible itself for this situation. Use scriptural vocabulary, not the person's modern wording.",
      },
      category: {
        type: "string",
        enum: [...PRAYER_CATEGORIES],
        description: "What kind of prayer or request this is.",
      },
      isSuffering: {
        type: "boolean",
        description:
          "True if this person appears to be in acute distress, grief, fear, or crisis right now.",
      },
      reading: {
        type: "string",
        description:
          "One sentence on what is really being asked, especially where the surface request and the underlying need differ.",
      },
    },
    required: ["themes", "searchTerms", "category", "isSuffering"],
  },
};

// ---------------------------------------------------------------------------
// Passage selection and response
// ---------------------------------------------------------------------------

export const citationSchema = z.object({
  reference: z.string().min(1),
  context: z.string().min(1),
  relevance: z.string().optional(),
});

export const selectionSchema = z.object({
  citations: z.array(citationSchema).max(6),
  response: z.string().min(1),
  prayer: z.string().optional(),
  correction: z.string().optional(),
  triageNote: z.string().optional(),
  noRelevantScripture: z.boolean().optional(),
});

export type Selection = z.infer<typeof selectionSchema>;

export const SELECTION_TOOL = {
  name: "offer_scripture",
  description:
    "Offer selected passages and a response. Verse text is rendered by the application from its own copy of the Bible; do not include it here.",
  input_schema: {
    type: "object" as const,
    properties: {
      citations: {
        type: "array",
        maxItems: 6,
        description:
          "Passages that genuinely bear on the request. Prefer two or three well-chosen ones over many. May be empty if nothing fits.",
        items: {
          type: "object",
          properties: {
            reference: {
              type: "string",
              description:
                "Reference in the form 'Book Chapter:Verse' or 'Book Chapter:Verse-Verse', e.g. 'Romans 8:28' or '1 John 4:7-12'. Must fall inside one of the passages provided.",
            },
            context: {
              type: "string",
              description:
                "What this passage is saying, to whom, and in what situation. Required: a citation without its context is rejected.",
            },
            relevance: {
              type: "string",
              description: "Why this speaks to what the person brought.",
            },
          },
          required: ["reference", "context"],
        },
      },
      response: {
        type: "string",
        description:
          "A brief summary of what the cited Word says and why it bears on what they brought, in the register of \"God's Word reminds us that…\". Name each passage by reference as you turn to it — a reference on its own line is best — so the application can insert the verse text there. Scripture is the subject. Do not speak as God or as this tool. Do not quote verse text.",
      },
      prayer: {
        type: "string",
        description:
          "Optional prompt for how to pray the cited passages themselves: what to name, what to ask, what to leave with God. Instruction, not a scripted prayer. Never in the person's voice or in God's.",
      },
      correction: {
        type: "string",
        description:
          "Optional gentle correction, grounded in a cited passage. Omit entirely if the person is suffering, or if no passage genuinely addresses the pattern.",
      },
      triageNote: {
        type: "string",
        description:
          "Optional note that this touches a matter on which faithful Christians differ, and at what level.",
      },
      noRelevantScripture: {
        type: "boolean",
        description:
          "Set true when no provided passage genuinely addresses the request. Honest silence is preferable to a forced citation.",
      },
    },
    required: ["citations", "response"],
  },
};

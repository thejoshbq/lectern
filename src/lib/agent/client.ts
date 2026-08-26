/**
 * Model access, through OpenRouter.
 *
 * OpenRouter speaks the OpenAI chat-completions protocol, so the official
 * `openai` client works against it with a different base URL. Everything
 * provider-shaped is contained in this file: the rest of the pipeline deals in
 * `ChatMessage` and never learns which vendor answered.
 *
 * Two models, chosen for what each step is actually doing. Query expansion is
 * mechanical preparation, so it uses the fast one. Passage selection is where
 * the theological judgment happens — deciding whether a text genuinely bears
 * on a person's grief, and whether its context permits the use — so it gets
 * the strongest model available.
 *
 * Both are overridable. Any OpenRouter slug that supports forced tool calls
 * will work, and `callStructured` fails loudly if the chosen model does not,
 * because structured output is what keeps the model from inventing Scripture.
 */

import OpenAI from "openai";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export const MODEL_SELECT =
  process.env.LECTERN_MODEL_SELECT ?? "anthropic/claude-opus-5";
export const MODEL_EXPAND =
  process.env.LECTERN_MODEL_EXPAND ?? "anthropic/claude-haiku-4.5";

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and add " +
        "your key from https://openrouter.ai/keys",
    );
  }

  client = new OpenAI({
    apiKey,
    // Overridable so the wire format can be exercised against a local stand-in,
    // and so a self-hosted gateway can be used without a code change.
    baseURL: process.env.LECTERN_OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL,
    // Attribution headers OpenRouter uses for its activity dashboard. Optional,
    // and harmless when the app is running on localhost.
    defaultHeaders: {
      "HTTP-Referer": process.env.LECTERN_PUBLIC_URL ?? "http://localhost:3000",
      "X-Title": "Lectern",
    },
  });

  return client;
}

/** Test seam: drops the cached client so env changes take effect. */
export function resetClient(): void {
  client = null;
}

/**
 * A message in provider-neutral shape.
 *
 * This mirrors the OpenAI protocol closely because that is what OpenRouter
 * accepts, but the pipeline builds these through the helpers below rather than
 * assembling wire formats itself.
 */
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
  toolCallId?: string;
}

export function userMessage(content: string): ChatMessage {
  return { role: "user", content };
}

/**
 * Builds the pair of turns that hands verification failures back to the model.
 *
 * The model's own tool call is replayed as an assistant turn, then answered
 * with a tool result describing what was rejected. Feeding the failure back in
 * the same shape the model produced is what lets it correct a specific citation
 * rather than starting over blind.
 */
export function toolRetryTurns(
  toolName: string,
  rawInput: unknown,
  feedback: string,
): ChatMessage[] {
  const id = `retry_${Math.random().toString(36).slice(2, 10)}`;

  return [
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id, name: toolName, argumentsJson: JSON.stringify(rawInput ?? {}) },
      ],
    },
    { role: "tool", content: feedback, toolCallId: id },
  ];
}

function toWireMessages(
  system: string,
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const wire: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const message of messages) {
    if (message.role === "tool") {
      wire.push({
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "",
      });
      continue;
    }

    if (message.role === "assistant") {
      wire.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            }
          : {}),
      });
      continue;
    }

    wire.push({ role: "user", content: message.content });
  }

  return wire;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface StructuredCallOptions<T> {
  model: string;
  system: string;
  messages: ChatMessage[];
  tool: ToolDefinition;
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Calls the model with a forced tool invocation and validates the result.
 *
 * Forcing the tool is what makes the output structured; validating it is what
 * makes the structure trustworthy. A model that answers in prose instead of
 * calling the tool is treated as a failure rather than parsed leniently.
 */
export async function callStructured<T>(
  options: StructuredCallOptions<T>,
): Promise<{ value: T; raw: unknown }> {
  const response = await getClient().chat.completions.create({
    model: options.model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 1,
    messages: toWireMessages(options.system, options.messages),
    tools: [
      {
        type: "function",
        function: {
          name: options.tool.name,
          description: options.tool.description,
          parameters: options.tool.input_schema,
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: options.tool.name },
    },
  });

  // OpenRouter reports upstream provider failures in the body with a 200, so a
  // resolved promise is not on its own evidence that anything worked.
  const errored = response as unknown as { error?: { message?: string } };
  if (errored.error) {
    throw new Error(
      `OpenRouter returned an error: ${errored.error.message ?? "unknown"}`,
    );
  }

  const choice = response.choices?.[0];
  const call = choice?.message?.tool_calls?.[0];

  if (!call || !("function" in call)) {
    throw new Error(
      `Model did not call ${options.tool.name}. ` +
        `Finish reason: ${choice?.finish_reason ?? "unknown"}. ` +
        `${(choice?.message?.content ?? "").slice(0, 200)}`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new Error(
      `${options.tool.name} returned arguments that are not valid JSON: ` +
        `${call.function.arguments.slice(0, 200)}`,
    );
  }

  const parsed = options.schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `${options.tool.name} returned an unexpected shape: ${parsed.error.message}`,
    );
  }

  return { value: parsed.data, raw: input };
}

/**
 * Wire-format tests for the OpenRouter client.
 *
 * These run the real client against a local stand-in that speaks the OpenAI
 * chat-completions protocol, so the request body is checked as it actually goes
 * out rather than as it was intended. Structured output is the mechanism that
 * stops the model inventing Scripture, and it rests entirely on the tool call
 * being formed correctly — a detail that typechecks whether or not it is right.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callStructured,
  resetClient,
  toolRetryTurns,
  userMessage,
} from "./client.ts";

interface Captured {
  path: string;
  auth?: string;
  title?: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl = "";
let captured: Captured[] = [];
let respond: () => { status: number; body: unknown } = () => ({
  status: 200,
  body: toolCallResponse({ ok: true }),
});

function toolCallResponse(args: unknown, name = "test_tool") {
  return {
    id: "gen-1",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      captured.push({
        path: req.url ?? "",
        auth: req.headers.authorization,
        title: req.headers["x-title"] as string | undefined,
        body: JSON.parse(raw || "{}"),
      });
      const { status, body } = respond();
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  }

  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.LECTERN_OPENROUTER_BASE_URL = baseUrl;
  resetClient();
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  captured = [];
  respond = () => ({ status: 200, body: toolCallResponse({ ok: true }) });
  resetClient();
});

const TOOL = {
  name: "test_tool",
  description: "A tool.",
  input_schema: {
    type: "object" as const,
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
};

const schema = z.object({ ok: z.boolean() });

async function call(messages = [userMessage("hello")]) {
  return callStructured({
    model: "test/model",
    system: "You are a test.",
    messages,
    tool: TOOL,
    schema,
  });
}

describe("OpenRouter request shape", () => {
  it("posts to the chat completions endpoint with the key", async () => {
    await call();
    expect(captured[0].path).toBe("/api/v1/chat/completions");
    expect(captured[0].auth).toBe("Bearer sk-or-test");
  });

  it("sends the attribution title OpenRouter uses", async () => {
    await call();
    expect(captured[0].title).toBe("Lectern");
  });

  it("forces the tool so output cannot come back as prose", async () => {
    await call();
    expect(captured[0].body.tool_choice).toEqual({
      type: "function",
      function: { name: "test_tool" },
    });
  });

  it("declares the tool with its schema as function parameters", async () => {
    await call();
    const tools = captured[0].body.tools as {
      type: string;
      function: { name: string; parameters: unknown };
    }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("test_tool");
    expect(tools[0].function.parameters).toEqual(TOOL.input_schema);
  });

  it("carries the system prompt as a system message", async () => {
    await call();
    const messages = captured[0].body.messages as {
      role: string;
      content: string;
    }[];
    expect(messages[0]).toEqual({ role: "system", content: "You are a test." });
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });
});

describe("retry turns", () => {
  it("replays the tool call and answers it as a tool result", async () => {
    const turns = toolRetryTurns("test_tool", { ok: false }, "Rejected.");
    await call([userMessage("hello"), ...turns]);

    const messages = captured[0].body.messages as Record<string, unknown>[];
    const assistant = messages[2];
    const toolResult = messages[3];

    const toolCalls = assistant.tool_calls as {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];

    expect(assistant.role).toBe("assistant");
    expect(toolCalls[0].type).toBe("function");
    expect(toolCalls[0].function.name).toBe("test_tool");
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ ok: false });

    expect(toolResult.role).toBe("tool");
    expect(toolResult.content).toBe("Rejected.");
    // The result must point at the call it answers, or the provider rejects
    // the conversation outright.
    expect(toolResult.tool_call_id).toBe(toolCalls[0].id);
  });
});

describe("response handling", () => {
  it("parses and validates the tool arguments", async () => {
    respond = () => ({ status: 200, body: toolCallResponse({ ok: true }) });
    const { value } = await call();
    expect(value).toEqual({ ok: true });
  });

  it("rejects arguments that do not match the schema", async () => {
    respond = () => ({
      status: 200,
      body: toolCallResponse({ ok: "not a boolean" }),
    });
    await expect(call()).rejects.toThrow(/unexpected shape/);
  });

  it("rejects malformed JSON rather than guessing at it", async () => {
    respond = () => ({
      status: 200,
      body: {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "test_tool", arguments: "{broken" },
                },
              ],
            },
          },
        ],
      },
    });
    await expect(call()).rejects.toThrow(/not valid JSON/);
  });

  it("fails when the model answers in prose instead of calling the tool", async () => {
    respond = () => ({
      status: 200,
      body: {
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "I would rather not." },
          },
        ],
      },
    });
    await expect(call()).rejects.toThrow(/did not call test_tool/);
  });

  it("surfaces an upstream error returned in a 200 body", async () => {
    // OpenRouter reports provider failures this way, so a resolved promise is
    // not on its own evidence that anything worked.
    respond = () => ({
      status: 200,
      body: { error: { message: "upstream is down" } },
    });
    await expect(call()).rejects.toThrow(/upstream is down/);
  });
});

describe("missing credentials", () => {
  it("names the variable and where to get it", async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    resetClient();

    await expect(call()).rejects.toThrow(/OPENROUTER_API_KEY is not set/);
    await expect(call()).rejects.toThrow(/openrouter\.ai\/keys/);

    process.env.OPENROUTER_API_KEY = saved;
    resetClient();
  });
});

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";

import type {
  ClientCitation,
  ClientResult,
  Stage,
  StreamEvent,
} from "@/lib/agent/wire";
import { composeAnswer } from "@/lib/client/compose";
import { finishNdjson, takeNdjsonLines } from "@/lib/client/stream";
import {
  deleteConversation,
  listConversations,
  newConversationId,
  saveConversation,
  titleFrom,
  type Conversation,
  type StoredTurn,
} from "@/lib/client/storage";
import { Citation } from "./Scripture";

const STAGE_LABELS: Record<Stage, string> = {
  checking: "Reading what you wrote",
  understanding: "Understanding the request",
  searching: "Searching Scripture",
  reading: "Reading the passages in context",
  verifying: "Verifying every citation",
  done: "",
};

const OPENERS = [
  "I'd like to pray for provision — I'm anxious about money and I can't stop worrying.",
  "I'd like to pray as I grieve my father.",
  "I'd like to pray about a sin I keep falling into.",
  "I'd like to give thanks, but I don't have the words.",
];

export function Chat({ email }: { email: string }) {
  const router = useRouter();
  const [conversation, setConversation] = useState<Conversation>(() => ({
    id: newConversationId(),
    title: "",
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  const [input, setInput] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const latestTurnRef = useRef<HTMLElement>(null);
  const pendingRef = useRef<HTMLElement>(null);
  const previousTurnCount = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const busy = stage !== null;

  // Reopen where the reader left off. Someone who closed the tab mid-request
  // should not lose it, and history is worthless if it is only ever written.
  useEffect(() => {
    let cancelled = false;

    void listConversations().then((saved) => {
      if (cancelled) return;
      setHistory(saved);
      const latest = saved[0];
      if (latest && latest.turns.length > 0) setConversation(latest);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

    if (conversation.turns.length > previousTurnCount.current) {
      previousTurnCount.current = conversation.turns.length;
      latestTurnRef.current?.scrollIntoView({ behavior, block: "start" });
      return;
    }

    previousTurnCount.current = conversation.turns.length;

    if (stage) {
      pendingRef.current?.scrollIntoView({ behavior, block: "end" });
      return;
    }

    if (error) {
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    }
  }, [conversation.turns.length, stage, error]);

  const startNew = useCallback(() => {
    if (busy) return;
    setConversation({
      id: newConversationId(),
      title: "",
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setError(null);
    setShowHistory(false);
  }, [busy]);

  const openConversation = useCallback(
    (target: Conversation) => {
      if (busy) return;
      setConversation(target);
      setError(null);
      setShowHistory(false);
    },
    [busy],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      setHistory((previous) => previous.filter((c) => c.id !== id));
      // Erasing the conversation on screen should clear the screen too,
      // otherwise "delete" only half means it.
      setConversation((previous) =>
        previous.id === id
          ? {
              id: newConversationId(),
              title: "",
              turns: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
          : previous,
      );
    },
    [],
  );

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setError(null);
      setInput("");
      setPending(trimmed);
      setStage("checking");

      // Only prose crosses to the server as history; Scripture is re-resolved
      // from the corpus every turn rather than round-tripped through the client.
      const history = conversation.turns.flatMap((turn) => [
        { role: "user" as const, content: turn.request },
        { role: "assistant" as const, content: turn.result.response },
      ]);

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history: history.slice(-8) }),
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? "The request failed.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: ClientResult | null = null;

        const applyLines = (lines: string[]) => {
          for (const line of lines) {
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "stage") setStage(event.stage);
            else if (event.type === "result") result = event.result;
            else if (event.type === "error") throw new Error(event.message);
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: true });
          }
          if (done) {
            buffer += decoder.decode();
            const { lines, rest } = takeNdjsonLines(buffer);
            applyLines(lines);
            applyLines(finishNdjson(rest));
            break;
          }

          const next = takeNdjsonLines(buffer);
          buffer = next.rest;
          applyLines(next.lines);
        }

        if (!result) throw new Error("The response ended unexpectedly.");

        const turn: StoredTurn = {
          id: crypto.randomUUID(),
          request: trimmed,
          result,
          at: Date.now(),
        };

        setConversation((previous) => {
          const next: Conversation = {
            ...previous,
            title: previous.title || titleFrom(trimmed),
            turns: [...previous.turns, turn],
            updatedAt: Date.now(),
          };
          void saveConversation(next);
          setHistory((saved) => [
            next,
            ...saved.filter((c) => c.id !== next.id),
          ]);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setStage(null);
        setPending(null);
      }
    },
    [busy, conversation.turns, router],
  );

  const empty = conversation.turns.length === 0 && !pending;

  const pickOpener = useCallback(
    (text: string) => {
      setInput(text);
      void submit(text);
    },
    [submit],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5">
      <header className="flex shrink-0 items-baseline justify-between gap-4 py-8">
        <h1 className="text-ink text-sm font-medium tracking-[0.2em] uppercase">
          Lectern
        </h1>

        <div className="flex items-baseline gap-4">
          <p className="text-ink-faint hidden max-w-40 truncate text-xs sm:block">
            {email}
          </p>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="text-ink-faint hover:text-ink focus-visible:ring-accent/50 rounded px-1.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              History
            </button>
          )}
          {!empty && (
            <button
              type="button"
              onClick={startNew}
              disabled={busy}
              className="text-ink-faint hover:text-ink focus-visible:ring-accent/50 rounded px-1.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
            >
              New
            </button>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="text-ink-faint hover:text-ink focus-visible:ring-accent/50 rounded px-1.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {showHistory && (
        <HistoryPanel
          conversations={history}
          currentId={conversation.id}
          onOpen={openConversation}
          onDelete={(id) => void removeConversation(id)}
          onClose={() => setShowHistory(false)}
        />
      )}

      <main className="min-h-0 flex-1 overflow-y-auto pb-4">
        {empty && <Welcome onPick={pickOpener} />}

        {conversation.turns.map((turn, index) => (
          <Turn
            key={turn.id}
            turn={turn}
            answerRef={
              index === conversation.turns.length - 1 ? latestTurnRef : undefined
            }
          />
        ))}

        {pending && (
          <article ref={pendingRef} className="mb-8">
            <Request text={pending} />
            {stage && stage !== "done" && (
              <p className="text-ink-faint flex items-center gap-2 text-sm">
                <span className="bg-accent/70 inline-block size-1.5 animate-pulse rounded-full" />
                {STAGE_LABELS[stage]}
              </p>
            )}
          </article>
        )}

        {error && (
          <div className="border-danger/40 bg-danger/10 text-ink mb-8 rounded-lg border px-4 py-3 text-sm">
            <p className="mb-1 font-medium">Something went wrong</p>
            <p className="text-ink-muted">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div className="bg-base/95 shrink-0 pb-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(input);
          }}
          className="border-line bg-raised focus-within:border-line-strong rounded-xl border transition-colors"
        >
          <label htmlFor="request" className="sr-only">
            I'd like to pray for…
          </label>
          <textarea
            id="request"
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              const el = event.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(input);
              }
            }}
            rows={2}
            disabled={busy}
            placeholder="I'd like to pray for…"
            className="text-ink placeholder:text-ink-faint w-full resize-none bg-transparent px-4 py-3 text-[0.9375rem] leading-relaxed outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <p className="text-ink-faint text-xs">
              A tool, not a replacement for prayer, Scripture, or your church.
            </p>
            <button
              type="button"
              onClick={() => void submit(input)}
              disabled={busy || !input.trim()}
              className="bg-overlay text-ink hover:bg-line disabled:text-ink-faint focus-visible:ring-accent/50 rounded-lg px-3.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:bg-overlay"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HistoryPanel({
  conversations,
  currentId,
  onOpen,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  currentId: string;
  onOpen: (conversation: Conversation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="border-line bg-raised mb-6 rounded-xl border">
      <div className="border-line/70 flex items-center justify-between border-b px-4 py-2.5">
        <p className="text-ink-faint text-xs tracking-wide uppercase">
          Saved on this device
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-faint hover:text-ink rounded px-1 text-xs transition-colors"
        >
          Close
        </button>
      </div>

      <ul className="max-h-72 overflow-y-auto py-1">
        {conversations.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 px-2">
            <button
              type="button"
              onClick={() => onOpen(c)}
              className={[
                "min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm transition-colors",
                c.id === currentId
                  ? "text-ink"
                  : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              <span className="block truncate">{c.title || "Untitled"}</span>
              <span className="text-ink-faint text-xs">
                {c.turns.length} {c.turns.length === 1 ? "request" : "requests"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              aria-label={`Delete ${c.title || "conversation"}`}
              className="text-ink-faint hover:text-danger focus-visible:ring-accent/50 shrink-0 rounded px-2 py-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <p className="border-line/70 text-ink-faint border-t px-4 py-2.5 text-xs leading-relaxed">
        These never leave your browser. Nothing here was sent to a server or
        kept after the answer came back.
      </p>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="py-10">
      <p className="font-scripture text-ink text-xl leading-relaxed">
        Say what you'd like to pray for — a worry, a thanks, a question.
        Receive Scripture that speaks to it, in its own context.
      </p>
      <p className="text-ink-muted mt-4 text-sm leading-relaxed">
        Every passage here is read from the Berean Standard Bible and checked
        before it reaches you. Nothing is written from memory, and nothing is
        offered without the surrounding passage it belongs to. This tool points
        to God through His Word; it does not speak for Him.
      </p>

      <div className="mt-8 space-y-2">
        {OPENERS.map((opener) => (
          <button
            key={opener}
            type="button"
            onClick={() => onPick(opener)}
            className="border-line text-ink-muted hover:border-line-strong hover:text-ink w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors"
          >
            {opener}
          </button>
        ))}
      </div>
    </div>
  );
}

function Request({ text }: { text: string }) {
  return (
    <div className="border-line-strong mb-5 border-l-2 pl-4">
      <p className="text-ink-muted text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

function Turn({
  turn,
  answerRef,
}: {
  turn: StoredTurn;
  answerRef?: Ref<HTMLElement>;
}) {
  const { result } = turn;

  return (
    <article ref={answerRef} className="mb-12 scroll-mt-6">
      <Request text={turn.request} />

      {result.kind === "crisis" ? (
        <div className="border-danger/40 bg-danger/5 rounded-lg border px-5 py-4">
          <Prose text={result.response} />
        </div>
      ) : (
        <>
          {result.noRelevantScripture && result.citations.length === 0 && (
            <p className="text-ink-faint mb-4 text-sm italic">
              No passage is offered here, because none of what was found speaks
              directly to this.
            </p>
          )}

          <AnswerBody response={result.response} citations={result.citations} />

          {result.correction && (
            <div className="border-line mt-6 rounded-lg border px-4 py-3">
              <p className="text-ink-faint mb-1.5 text-xs tracking-wide uppercase">
                A gentle word
              </p>
              <Prose text={result.correction} className="text-[0.9375rem]" />
            </div>
          )}

          {result.prayer && (
            <div className="border-accent-muted/40 mt-6 border-l-2 pl-4">
              <p className="text-ink-faint mb-1.5 text-xs tracking-wide uppercase">
                How to pray
              </p>
              <Prose text={result.prayer} className="text-[0.9375rem]" />
            </div>
          )}

          {result.triageNote && (
            <p className="text-ink-faint mt-5 text-sm leading-relaxed">
              {result.triageNote}
            </p>
          )}
        </>
      )}
    </article>
  );
}

/**
 * Interleaves corpus-rendered citations into the model's prose so the
 * summary and the Scripture can be read as one answer.
 */
function AnswerBody({
  response,
  citations,
}: {
  response: string;
  citations: ClientCitation[];
}) {
  const byReference = new Map(
    citations.map((citation) => [citation.reference, citation]),
  );
  const blocks = composeAnswer(response, citations);

  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        if (block.type === "prose") {
          return <Prose key={index} text={block.text} />;
        }

        const citation = byReference.get(block.reference);
        if (!citation) return null;
        return <Citation key={citation.reference} citation={citation} />;
      })}
    </div>
  );
}

/**
 * Renders the agent's prose.
 *
 * Deliberately minimal: bold, links, and paragraphs. The agent's words are
 * always sans-serif and never styled like Scripture.
 */
function Prose({ text, className = "" }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <div className={`space-y-3 ${className}`}>
      {paragraphs.map((paragraph, i) => (
        <p
          key={i}
          className="text-ink text-[0.9375rem] leading-[1.7] whitespace-pre-wrap"
        >
          {renderInline(paragraph)}
        </p>
      ))}
    </div>
  );
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|(https?:\/\/[^\s)]+)/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));

    if (match[1]) {
      parts.push(
        <strong key={index} className="text-ink font-medium">
          {match[1]}
        </strong>,
      );
    } else if (match[2]) {
      parts.push(
        <a
          key={index}
          href={match[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline underline-offset-2"
        >
          {match[2]}
        </a>,
      );
    }

    last = index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

# Lectern

A tool for praying with Scripture. Say what you'd like to pray for — a worry,
a thanks, a question. It answers with passages from the Bible that actually
speak to it — shown in their own context, never as isolated verses — together
with a short summary of what that Word says, and a prompt for how to pray it
yourself. It does not speak as God, and it does not write a prayer for you to
copy.

It is not a replacement for prayer, for reading the Bible, or for your church.
It is meant to send you back to all three.

## The guarantee

The model never writes Scripture. It searches the corpus, chooses references,
and explains why they apply; the **server** renders the verse text from a local
copy of the Berean Standard Bible. A reference the model invents does not
resolve, and is rejected before anyone reads it.

The same structure prevents proof-texting. The unit of retrieval is the
**pericope** — the translators' own section divisions — so the model only ever
sees a passage surrounded by its context, and a citation is rejected unless it
falls inside a passage that search actually returned.

This is why `evals/gate.test.ts` matters more than any other test in the
repository. It runs offline, needs no API key, and asserts that fabricated
references, references outside the candidate set, quotations that do not match
the text, and references smuggled into prose are all refused.

## Setup

Requires Node 22.5 or newer, for the built-in `node:sqlite`.

```bash
npm install
cp .env.example .env.local
npm run bible:all            # download, build, verify, and embed the corpus
npm run dev
```

Fill in `.env.local` before starting the web app: `OPENROUTER_API_KEY` for the
models, plus `AUTH_SECRET` and `LECTERN_PASSWORD` so the app is not open to
the public. See [Authentication](#authentication).

Models are reached through [OpenRouter](https://openrouter.ai), so one key
covers both of them. Get it from [openrouter.ai/keys](https://openrouter.ai/keys).

Which models get used is configurable, and the defaults reflect what each step
is doing:

| Variable | Default | Role |
| --- | --- | --- |
| `LECTERN_MODEL_SELECT` | `anthropic/claude-opus-5` | Passage selection and the pastoral response — where the theological judgment happens |
| `LECTERN_MODEL_EXPAND` | `anthropic/claude-haiku-4.5` | Query expansion, a cheap mechanical step |

Any OpenRouter slug works as long as the model supports **forced tool calls**,
which is how responses are kept structured. A model without that support fails
loudly rather than falling back to free-form text, because unstructured output
is exactly where invented citations would slip through.

Embeddings are separate. The default provider runs locally and needs no key at
all; the hosted options call Voyage or OpenAI directly, since OpenRouter proxies
chat completions but not embeddings.

`bible:all` takes a few minutes, most of it spent generating embeddings. It
downloads the BSB, parses it, builds `data/bsb.sqlite`, verifies the result,
then embeds every passage locally. Nothing in `data/` or `vendor/` is committed;
all of it rebuilds from that one command.

Run the four steps separately if you need to:

| Command | What it does |
| --- | --- |
| `npm run bible:fetch` | Downloads and caches the BSB release |
| `npm run bible:build` | Parses it into `data/bsb.sqlite` |
| `npm run bible:verify` | Checks 66 books, 1,189 chapters, no unexpected gaps |
| `npm run bible:embed` | Generates passage embeddings for semantic search |

## Authentication

The web app is not public. `/api/ask` spends OpenRouter tokens, so every
request needs a valid session. There is one shared password: anyone who has
`LECTERN_PASSWORD` can unlock the app; anyone who does not cannot.

Generate a session signing secret with:

```bash
openssl rand -base64 32
```

| Variable | Role |
| --- | --- |
| `AUTH_SECRET` | Signs session cookies. At least 32 characters. |
| `LECTERN_PASSWORD` | Shared password required to use the web app |

Set the same two values on the Vercel project. Rotate the password if it
leaks. The CLI (`npm run lectern`) does not use this path; it still talks to
the models directly on your machine.

Nothing a reader types is stored. Follow-ups in the current tab can still
use the sitting as context; a reload starts blank.

## Using it without the browser

```bash
npm run lectern -- "I'd like to pray for provision — rent is due."
npm run lectern -- --retrieval-only "grief"   # search only, no API key needed
npm run lectern -- --diagnostics "..."        # show candidates and rejections
```

## Tests

```bash
npm test           # offline, no API key
npm run evals      # retrieval quality against known cases
npm run evals -- --adversarial   # full pipeline; needs OPENROUTER_API_KEY
```

`npm run evals` reports known gaps separately from failures. A case annotated
with `knownGap` in `evals/cases.ts` is a limitation someone chose to document
rather than hide — and the runner fails if one of them starts passing, so the
annotation cannot quietly become a lie.

## Where the theology lives

`docs/` holds the doctrinal content as prose, compiled into the system prompt at
runtime:

- `hermeneutics.md` — how a passage is read: authorial intent, genre, context,
  using biblical narrative without allegory, and the prohibition on claiming
  decontextualized promises.
- `triage.md` — what is worth dividing over. First-order doctrine held firmly,
  second-order presented fairly with a Reformed lean, third-order left free.
- `guardrails.md` — never speak as God or as the tool, never claim revelation,
  never pronounce on someone's salvation, prompt how to pray rather than write
  a script, always point back to the church.

Editing those files changes the agent's behavior. That is deliberate: the
theology governing this tool should be reviewable and arguable as a document,
not buried in string literals.

## Crisis input

Messages indicating self-harm, abuse, or intent to harm others short-circuit
before any model runs and return a fixed, human-written response with real
helplines. That path is in `src/lib/agent/crisis.ts` and is never improvised.

## Text

Berean Standard Bible, public domain (CC0). Chosen so the whole text could be
stored and indexed without a license ceiling — the ESV, for one, forbids storing
more than 500 verses.

The BSB follows modern critical texts, so sixteen verses present in the KJV do
not appear. They are enumerated in `src/lib/bible/omissions.ts`, treated as
expected by the verifier, and noted in the UI when a citation spans one, rather
than silently vanishing.

/**
 * Embedding providers for dense retrieval.
 *
 * Dense retrieval is an enhancement here, never a dependency. The corpus ships
 * with lexical indexes that work on their own, and every code path degrades to
 * lexical-only when no provider is configured or no vectors have been built.
 * That keeps the project runnable with nothing but an OpenRouter key, and keeps
 * a vendor outage from taking Scripture search offline.
 *
 * The local `transformers` provider is the default because it adds no second
 * vendor and no per-query cost. Hosted providers are available for deployments
 * where a ~400 MB resident model is the wrong trade. Note that these call the
 * vendors directly with their own keys: OpenRouter proxies chat completions,
 * not embeddings.
 */

export interface EmbeddingProvider {
  /** Stable identifier recorded in the corpus so stale vectors are detectable. */
  id: string;
  dim: number;
  /** Embeds corpus passages. */
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  /** Embeds a user query, applying any asymmetric-retrieval prefix. */
  embedQuery(text: string): Promise<Float32Array>;
}

export type ProviderName = "transformers" | "voyage" | "openai" | "none";

const DEFAULT_LOCAL_MODEL = "Xenova/bge-base-en-v1.5";

/**
 * BGE models are trained for asymmetric retrieval: queries carry this
 * instruction, passages do not. Omitting it measurably degrades ranking.
 */
const BGE_QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

export function configuredProviderName(): ProviderName {
  const raw = (process.env.LECTERN_EMBEDDING_PROVIDER ?? "transformers").toLowerCase();
  if (raw === "transformers" || raw === "voyage" || raw === "openai" || raw === "none") {
    return raw;
  }
  throw new Error(
    `Unknown LECTERN_EMBEDDING_PROVIDER "${raw}". ` +
      `Expected one of: transformers, voyage, openai, none.`,
  );
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] /= magnitude;
  return vector;
}

// ---------------------------------------------------------------------------
// Local, via transformers.js
// ---------------------------------------------------------------------------

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

async function createTransformersProvider(): Promise<EmbeddingProvider> {
  const model = process.env.LECTERN_EMBEDDING_MODEL ?? DEFAULT_LOCAL_MODEL;

  let transformers: typeof import("@huggingface/transformers");
  try {
    transformers = await import("@huggingface/transformers");
  } catch {
    throw new Error(
      "The local embedding provider needs @huggingface/transformers.\n" +
        "Install it with:  npm install -D --ignore-scripts @huggingface/transformers\n" +
        "(--ignore-scripts skips `sharp`, an image dependency this project never uses.)\n" +
        "Or set LECTERN_EMBEDDING_PROVIDER=none to run on lexical search alone.",
    );
  }

  const dtype = process.env.LECTERN_EMBEDDING_DTYPE ?? "fp32";
  const extractor = (await transformers.pipeline("feature-extraction", model, {
    dtype: dtype as "fp32" | "fp16" | "q8",
  })) as unknown as FeatureExtractor;

  const probe = await extractor(["dimension probe"], {
    pooling: "mean",
    normalize: true,
  });
  const dim = probe.tolist()[0].length;

  const usesBgePrefix = /bge/i.test(model);

  return {
    id: `transformers:${model}`,
    dim,
    async embedDocuments(texts) {
      if (texts.length === 0) return [];
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return output.tolist().map((row) => normalize(Float32Array.from(row)));
    },
    async embedQuery(text) {
      const prepared = usesBgePrefix ? BGE_QUERY_PREFIX + text : text;
      const output = await extractor([prepared], {
        pooling: "mean",
        normalize: true,
      });
      return normalize(Float32Array.from(output.tolist()[0]));
    },
  };
}

// ---------------------------------------------------------------------------
// Hosted providers
// ---------------------------------------------------------------------------

async function embedViaHttp(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<number[][]> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Embedding request failed: HTTP ${response.status} ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    data: { embedding: number[]; index?: number }[];
  };

  return payload.data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding);
}

function createVoyageProvider(): EmbeddingProvider {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("LECTERN_EMBEDDING_PROVIDER=voyage requires VOYAGE_API_KEY");
  }
  const model = process.env.LECTERN_EMBEDDING_MODEL ?? "voyage-3";

  const call = async (texts: string[], inputType: "document" | "query") =>
    embedViaHttp(
      "https://api.voyageai.com/v1/embeddings",
      { Authorization: `Bearer ${apiKey}` },
      { model, input: texts, input_type: inputType },
    );

  return {
    id: `voyage:${model}`,
    // Voyage reports the dimension in its response; 1024 is the family default
    // and is corrected on first use by the build script.
    dim: 1024,
    async embedDocuments(texts) {
      if (texts.length === 0) return [];
      return (await call(texts, "document")).map((row) =>
        normalize(Float32Array.from(row)),
      );
    },
    async embedQuery(text) {
      const [row] = await call([text], "query");
      return normalize(Float32Array.from(row));
    },
  };
}

function createOpenAiProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("LECTERN_EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY");
  }
  const model = process.env.LECTERN_EMBEDDING_MODEL ?? "text-embedding-3-small";

  const call = async (texts: string[]) =>
    embedViaHttp(
      "https://api.openai.com/v1/embeddings",
      { Authorization: `Bearer ${apiKey}` },
      { model, input: texts },
    );

  return {
    id: `openai:${model}`,
    dim: model.includes("large") ? 3072 : 1536,
    async embedDocuments(texts) {
      if (texts.length === 0) return [];
      return (await call(texts)).map((row) => normalize(Float32Array.from(row)));
    },
    async embedQuery(text) {
      const [row] = await call([text]);
      return normalize(Float32Array.from(row));
    },
  };
}

// ---------------------------------------------------------------------------

let cached: Promise<EmbeddingProvider | null> | null = null;

/**
 * Returns the configured provider, or null when dense retrieval is disabled.
 *
 * The result is memoized because the local provider holds a multi-hundred
 * megabyte model; loading it per request would be untenable.
 */
export function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  cached ??= createProvider();
  return cached;
}

async function createProvider(): Promise<EmbeddingProvider | null> {
  const name = configuredProviderName();
  switch (name) {
    case "none":
      return null;
    case "transformers":
      return createTransformersProvider();
    case "voyage":
      return createVoyageProvider();
    case "openai":
      return createOpenAiProvider();
  }
}

/** Test seam: forces the next call to rebuild the provider. */
export function resetEmbeddingProvider(): void {
  cached = null;
}

export { normalize as normalizeVector };

/**
 * Embeds every chunk in the corpus for dense retrieval.
 *
 * Optional. Retrieval works on lexical search alone; embeddings add the
 * recall that matters most for this application, where someone writes "I feel
 * far from God" and the passage that meets them is Psalm 88, which shares
 * almost no vocabulary with the request.
 *
 * Usage:
 *   npm run bible:embed
 *   npm run bible:embed -- --force     # re-embed even if vectors exist
 *   LECTERN_EMBEDDING_PROVIDER=voyage npm run bible:embed
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

import {
  configuredProviderName,
  getEmbeddingProvider,
} from "../src/lib/embedding/provider.ts";
import { CORPUS_DB } from "../src/lib/paths.ts";

const BATCH_SIZE = Number(process.env.LECTERN_EMBEDDING_BATCH ?? 16);

interface ChunkRow {
  id: number;
  text: string;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function main() {
  const force = process.argv.includes("--force");

  if (!existsSync(CORPUS_DB)) {
    throw new Error(
      `No corpus at ${CORPUS_DB}. Run \`npm run bible:build\` first.`,
    );
  }

  if (configuredProviderName() === "none") {
    console.log(
      "LECTERN_EMBEDDING_PROVIDER=none — skipping. Retrieval will use lexical search only.",
    );
    return;
  }

  console.log("Loading embedding provider ...");
  const provider = await getEmbeddingProvider();
  if (!provider) {
    console.log("No embedding provider configured; nothing to do.");
    return;
  }
  console.log(`Provider: ${provider.id} (${provider.dim} dimensions)`);

  const db = new DatabaseSync(CORPUS_DB);

  const existingId = (
    db.prepare("select value from meta where key = 'embeddingModel'").get() as
      | { value: string }
      | undefined
  )?.value;
  const existingCount = (
    db.prepare("select count(*) n from chunk_vectors").get() as { n: number }
  ).n;
  const chunkCount = (
    db.prepare("select count(*) n from chunks").get() as { n: number }
  ).n;

  if (
    !force &&
    existingCount === chunkCount &&
    chunkCount > 0 &&
    existingId === provider.id
  ) {
    console.log(
      `${existingCount} vectors already present for ${provider.id}. Use --force to rebuild.`,
    );
    db.close();
    return;
  }

  // Vectors from a different model are not comparable with new ones, so a
  // provider change discards the whole set rather than mixing spaces.
  if (existingCount > 0) {
    console.log(`Clearing ${existingCount} existing vectors ...`);
    db.exec("delete from chunk_vectors");
  }

  const chunks = db
    .prepare("select id, text from chunks order by id")
    .all() as unknown as ChunkRow[];

  console.log(`Embedding ${chunks.length} chunks in batches of ${BATCH_SIZE} ...`);

  const insert = db.prepare(
    "insert into chunk_vectors (chunk_id, dim, vec) values (?, ?, ?)",
  );

  const started = Date.now();
  let done = 0;
  let dim = provider.dim;

  for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + BATCH_SIZE);
    const vectors = await provider.embedDocuments(batch.map((c) => c.text));

    if (vectors.length !== batch.length) {
      throw new Error(
        `Provider returned ${vectors.length} vectors for ${batch.length} inputs`,
      );
    }

    db.exec("begin");
    for (const [i, vector] of vectors.entries()) {
      // Trust the vectors over the provider's declared dimension; hosted
      // models occasionally differ from their documented defaults.
      dim = vector.length;
      insert.run(
        batch[i].id,
        dim,
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      );
    }
    db.exec("commit");

    done += batch.length;

    const elapsed = Date.now() - started;
    const rate = done / (elapsed / 1000);
    const remaining = (chunks.length - done) / rate;
    process.stdout.write(
      `\r  ${done}/${chunks.length} (${((done / chunks.length) * 100).toFixed(1)}%) ` +
        `· ${rate.toFixed(1)}/s · eta ${formatDuration(remaining * 1000)}   `,
    );
  }

  process.stdout.write("\n");

  const upsert = db.prepare(
    "insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
  );
  db.exec("begin");
  upsert.run("embeddingModel", provider.id);
  upsert.run("embeddingDim", String(dim));
  upsert.run("embeddingCount", String(done));
  upsert.run("embeddedAt", new Date().toISOString());
  db.exec("commit");

  db.exec("pragma wal_checkpoint(truncate)");
  db.close();

  console.log(
    `\nEmbedded ${done} chunks with ${provider.id} in ${formatDuration(Date.now() - started)}.\n` +
      `Next: npm run bible:verify`,
  );
}

main().catch((err) => {
  console.error(`\nbuild-embeddings failed: ${err.message}`);
  process.exit(1);
});

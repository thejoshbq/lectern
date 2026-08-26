import { RETRIEVAL_CASES } from "../evals/cases.ts";
import { openCorpus, getPassages } from "../src/lib/bible/corpus.ts";
import { getEmbeddingProvider } from "../src/lib/embedding/provider.ts";
import { parseReference, rangeStartKey } from "../src/lib/bible/reference.ts";

const provider = (await getEmbeddingProvider())!;
const db = openCorpus();

const rows = db
  .prepare(
    `select cv.chunk_id, cv.dim, cv.vec, c.passage_id from chunk_vectors cv
     join chunks c on c.id = cv.chunk_id`,
  )
  .all() as unknown as {
  chunk_id: number;
  dim: number;
  vec: Uint8Array;
  passage_id: number;
}[];

console.log("chunk vectors:", rows.length, "dim:", rows[0].dim);

function covers(p: { book: string; startKey: number; endKey: number }, ref: string) {
  const r = parseReference(ref);
  if (!r || r.book !== p.book) return false;
  const k = rangeStartKey(r);
  return p.startKey <= k && k <= p.endKey;
}

let hits = 0;
for (const c of RETRIEVAL_CASES) {
  const q = await provider.embedQuery(c.request);
  const best = new Map<number, number>();
  for (const row of rows) {
    const v = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength / 4);
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i] * v[i];
    const prev = best.get(row.passage_id);
    if (prev === undefined || dot > prev) best.set(row.passage_id, dot);
  }
  const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const passages = getPassages(top.map(([id]) => id));
  const byId = new Map(passages.map((p) => [p.id, p]));

  let rank = -1;
  let which = "";
  top.forEach(([id], i) => {
    const p = byId.get(id);
    if (!p || rank >= 0) return;
    const m = c.expectAnyOf.find((ref) => covers(p, ref));
    if (m) {
      rank = i + 1;
      which = m;
    }
  });

  if (rank > 0) hits++;
  console.log(
    (rank > 0 ? "  hit " : "  MISS") +
      ` ${c.name.padEnd(32)} ${rank > 0 ? `${which} @${rank}` : ""}`,
  );
  if (rank < 0) {
    top.slice(0, 4).forEach(([id, s]) => {
      const p = byId.get(id)!;
      console.log(`         ${s.toFixed(3)} ${p.ref} — ${p.heading}`);
    });
  }
}
console.log(`\nDENSE ONLY: ${hits}/${RETRIEVAL_CASES.length}`);

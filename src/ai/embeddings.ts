import 'server-only';

import { EMBEDDING_DIM } from '@/db/store.schema';
import { embedTexts, isAiConfigured } from './client';
import { EMBED_MODEL } from './models';
import { stubEmbedding } from './stub';

/**
 * Text embeddings via text-embedding-v4, pinned to EMBEDDING_DIM (768).
 *
 * The 768-dim output is an MRL truncation of the model's native space, so we
 * L2-normalize client-side or cosine ranking silently degrades. v4 is
 * symmetric — the same space serves documents and queries (no task type,
 * unlike the old Gemini RETRIEVAL_DOCUMENT/QUERY split).
 */

function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Embed a batch, returning null in the slot of any text the provider did not
 * return a usable vector for.
 *
 * This used to substitute stubEmbedding() for those slots, described in a
 * comment as "a zero-ish unit vector". It is not: stubEmbedding is a
 * full-magnitude unit vector of deterministic hash noise. A zero vector would
 * score ~0 against every query and rank last — harmless. A random unit vector
 * has non-trivial cosine against arbitrary neighbours, so it comes back from
 * `ORDER BY embedding <=> query` looking like a real match. Silently wrong
 * beats invisibly absent only if you never look.
 *
 * Null is the honest answer, and the storage layer already handles it: the
 * embedding column is nullable and the vector leg of hybrid search filters on
 * `embedding IS NOT NULL`, so a product without one still matches through the
 * trigram leg.
 */
async function embed(texts: string[]): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  // Offline/stub mode is a deliberate whole-batch substitution, not a failure:
  // callers want a deterministic space so the pipeline is exercisable without
  // credentials. re-embed refuses to run in this mode (it would overwrite real
  // vectors with noise) — see the ai_not_configured guard there.
  if (!isAiConfigured()) {
    return texts.map((t) => stubEmbedding(t, EMBEDDING_DIM));
  }
  const vectors = await embedTexts(EMBED_MODEL, texts, EMBEDDING_DIM);
  return texts.map((_text, i) => {
    const values = vectors[i] ?? [];
    if (values.length !== EMBEDDING_DIM) return null;
    return l2normalize(values);
  });
}

/**
 * Embed product search-text for storage. A null slot means "the provider
 * skipped this one" — store NULL rather than inventing a vector.
 */
export async function embedDocuments(
  texts: string[]
): Promise<(number[] | null)[]> {
  return embed(texts);
}

/**
 * Embed a shopper query for retrieval.
 *
 * Throws when no vector came back, on purpose: the caller already catches and
 * degrades to lexical-only search. Returning noise here defeats that mechanism
 * by making a broken embedder look like a working one.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  if (!v) throw new Error('embedQuery: provider returned no usable vector');
  return v;
}

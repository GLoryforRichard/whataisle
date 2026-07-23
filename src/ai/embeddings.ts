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

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!isAiConfigured()) {
    return texts.map((t) => stubEmbedding(t, EMBEDDING_DIM));
  }
  const vectors = await embedTexts(EMBED_MODEL, texts, EMBEDDING_DIM);
  return texts.map((text, i) => {
    const values = vectors[i] ?? [];
    if (values.length !== EMBEDDING_DIM) {
      // Defensive: fall back to a zero-ish unit vector rather than throwing.
      return stubEmbedding(text, EMBEDDING_DIM);
    }
    return l2normalize(values);
  });
}

/** Embed product search-text for storage. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts);
}

/** Embed a shopper query for retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  return v ?? stubEmbedding(text, EMBEDDING_DIM);
}

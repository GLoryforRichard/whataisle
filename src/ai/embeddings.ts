import 'server-only';

import { EMBEDDING_DIM } from '@/db/store.schema';
import { getGenAI, isAiConfigured } from './client';
import { EMBED_MODEL } from './models';
import { stubEmbedding } from './stub';

/**
 * Text embeddings via gemini-embedding-001, truncated to EMBEDDING_DIM (768).
 *
 * IMPORTANT: only the 3072-dim output is pre-normalized. At 768 dims we must
 * L2-normalize client-side, or cosine ranking silently degrades.
 * (See plan risk #4.)
 */

const TASK_DOCUMENT = 'RETRIEVAL_DOCUMENT';
const TASK_QUERY = 'RETRIEVAL_QUERY';

function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

async function embed(texts: string[], taskType: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!isAiConfigured()) {
    return texts.map((t) => stubEmbedding(t, EMBEDDING_DIM));
  }
  const genai = getGenAI();
  const res = await genai.models.embedContent({
    model: EMBED_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: EMBEDDING_DIM },
  });
  const embeddings = res.embeddings ?? [];
  return texts.map((_, i) => {
    const values = embeddings[i]?.values ?? [];
    if (values.length !== EMBEDDING_DIM) {
      // Defensive: fall back to a zero-ish unit vector rather than throwing.
      return stubEmbedding(texts[i], EMBEDDING_DIM);
    }
    return l2normalize(values);
  });
}

/** Embed product search-text for storage. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, TASK_DOCUMENT);
}

/** Embed a shopper query for retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], TASK_QUERY);
  return v ?? stubEmbedding(text, EMBEDDING_DIM);
}

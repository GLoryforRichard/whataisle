import 'server-only';

/**
 * Model ids. One generation model everywhere (multimodal: vision + audio +
 * text) keeps the pipeline simple. GEMINI_MODEL overrides because the Vertex
 * and AI Studio APIs don't always expose identical ids.
 */
export const GEN_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

/** Embedding model; output truncated to 768 dims (see EMBEDDING_DIM). */
export const EMBED_MODEL =
  process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

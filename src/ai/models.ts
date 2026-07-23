import 'server-only';

/**
 * Model ids (DashScope International / Model Studio). Unlike Gemini, Qwen
 * splits capabilities across model lines, so each modality has its own id.
 * All env-overridable — DashScope rotates "stable" ids over time and the
 * Singapore catalog differs from the mainland one.
 */

/**
 * Text + JSON tasks: alias generation, search bucketing, transcript cleanup.
 * Note: the bare id "qwen3.5" does NOT exist on DashScope intl (404) — only
 * -flash/-plus variants.
 */
export const GEN_MODEL = process.env.QWEN_MODEL || 'qwen3.5-flash';

/** Vision with grounding (bbox output, normalized 0–1000): shelf scan, find-by-photo. */
export const VISION_MODEL = process.env.QWEN_VISION_MODEL || 'qwen3-vl-plus';

/**
 * Audio-file transcription with context biasing. The bare id resolves on
 * chat/completions even though /models lists only dated variants.
 */
export const ASR_MODEL = process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash';

/** Embeddings; dimensions pinned to EMBEDDING_DIM (768) at the call site. */
export const EMBED_MODEL = process.env.QWEN_EMBED_MODEL || 'text-embedding-v4';

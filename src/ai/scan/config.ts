/**
 * Model ids and tunables for the OpenRouter-based shelf-scan engine.
 *
 * Deliberately separate from src/ai/models.ts: that file documents the
 * DashScope (Qwen) models that still power search/voice/aliases/embeddings;
 * this one covers only the detection pipeline, which was benchmarked and
 * ported from whataisle-readshelf with google/gemini-3.5-flash as champion.
 */

export const SCAN_MODEL =
  process.env.OPENROUTER_SCAN_MODEL || 'google/gemini-3.5-flash';

/** Cheap row detector; the champion model doubles as its own row detector. */
export const ROW_DETECT_MODEL = process.env.OPENROUTER_ROW_MODEL || SCAN_MODEL;

export const READOUT_MODEL = process.env.OPENROUTER_READOUT_MODEL || SCAN_MODEL;

/** Cheap gate for the landing try-out (is it a shelf? are labels legible?). */
export const PRECHECK_MODEL =
  process.env.OPENROUTER_PRECHECK_MODEL || 'google/gemini-3.5-flash-lite';

/** Process-wide OpenRouter concurrency governor (all call kinds share it). */
export const OPENROUTER_MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.OPENROUTER_MAX_CONCURRENT) || 32
);

/**
 * Band calls within one scan run in their own pool. Bands are independent
 * requests, so higher concurrency cuts wall-clock 1:1 with no accuracy
 * impact; lower it if the provider starts rate-limiting.
 */
export const BAND_CONCURRENCY = Math.max(
  1,
  Number(process.env.SCAN_BAND_CONCURRENCY) || 6
);

/**
 * Long-side cap for band slices cut from the full-resolution image.
 * 3072 measured as the sweet spot: ~4× effective pixels per product vs a
 * single 2048 whole-image call; going native-res was slower with no gain.
 */
export const MAX_BAND_SIDE = Math.max(
  512,
  Number(process.env.SCAN_MAX_BAND_SIDE) || 3072
);

/** Crops per stitched grid-readout image, and grid calls in flight at once. */
export const GRID_K = Math.max(2, Number(process.env.SCAN_GRID_K) || 6);
export const GRID_CONCURRENCY = Math.max(
  1,
  Number(process.env.SCAN_GRID_CONCURRENCY) || 6
);

/**
 * Whether the OpenRouter detection engine is usable. Mirrors the DashScope
 * isAiConfigured() split: AI_STUB=true forces stub mode for both providers.
 */
export function isScanConfigured(): boolean {
  if (process.env.AI_STUB === 'true') return false;
  return Boolean(process.env.OPENROUTER_API_KEY);
}

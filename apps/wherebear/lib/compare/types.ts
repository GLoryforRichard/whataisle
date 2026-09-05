/**
 * Shared contract for the /compare page: three scanning paradigms run over
 * the same shelf photo and must come back in ONE uniform shape so the UI can
 * lay them out side by side.
 *
 * Paradigms:
 *  A `wherebear`            — wherebear's two-stage pipeline (stage-1 detect →
 *                             sharp crop → stage-2 batch identify → dedupe),
 *                             Vertex AI, model forced to gemini-3.7-flash.
 *  B `whataisle-openrouter` — whataisle's final single-shot pipeline, called
 *                             through OpenRouter (google/gemini-3.6-flash).
 *  C `whataisle-vertex`     — whataisle's same algorithm, but on Google Cloud
 *                             Vertex AI, gemini-3.7-flash.
 */

import {
  DEFAULT_GEMINI_MODEL,
  vertexGlobalTokenPrice,
} from '@/lib/gemini-model.mjs';

export type CompareParadigm = 'wherebear' | 'whataisle-openrouter' | 'whataisle-vertex';

export const COMPARE_MODEL = DEFAULT_GEMINI_MODEL;
// OpenRouter has its own provider-specific model catalog. Keep the verified 3.6
// ID until that provider is upgraded independently from the Vertex migration.
export const OPENROUTER_COMPARE_MODEL = 'google/gemini-3.6-flash';

export interface CompareProduct {
  name: string;
  category?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** [y_min, x_min, y_max, x_max] normalized 0–1000 (upright image space).
   *  The representative (largest) box for this product. */
  box_2d?: [number, number, number, number];
  /** ALL detected boxes for this product (the whataisle pipeline can find the
   *  same product in several shelf spots). Overlay draws these; falls back to
   *  [box_2d] when absent. */
  boxes_2d?: [number, number, number, number][];
  /** How many separate spots this product was detected in. */
  count?: number;
  /** Small crop data URL when the paradigm produces one. */
  thumbnail?: string;
}

export interface CompareUsage {
  inputTokens: number;
  outputTokens: number;
  /** Number of model API calls made. */
  calls: number;
  /** Number of images sent to the model. */
  images: number;
}

export interface CompareRunResult {
  ok: boolean;
  paradigm: CompareParadigm;
  model: string;
  provider: string;
  products: CompareProduct[];
  count: number;
  /** Server-side wall time for the whole pipeline, ms. */
  elapsedMs: number;
  usage: CompareUsage;
  /** USD. Actual for OpenRouter (from its usage accounting), estimated from
   *  list price for Vertex. Null if unknown. */
  costUSD: number | null;
  costBasis: 'openrouter-actual' | 'list-price-estimate';
  /** Browser-displayable JPEG data URL of the (HEIC-converted, upright)
   *  uploaded photo — the overlay base image. Filled in by the route. */
  previewImage?: string;
  /** Per-stage wall times (ms), for latency debugging on the page. */
  stages?: Record<string, number>;
  error?: string;
}

export function estimateVertexCost(usage: CompareUsage): number {
  const price = vertexGlobalTokenPrice(COMPARE_MODEL);
  if (!price) throw new Error(`Missing Vertex price for ${COMPARE_MODEL}`);
  return (
    usage.inputTokens * price.inPerM + usage.outputTokens * price.outPerM
  ) / 1_000_000;
}

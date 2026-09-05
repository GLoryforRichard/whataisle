/**
 * Gemini price table for per-call cost estimation.
 *
 * Vertex AI returns no billed-cost field (unlike OpenRouter's usage.cost), so
 * costUsd is ESTIMATED here from token counts. Thinking tokens bill at the
 * output rate. Unknown model → null, preserving cost.ts's sumCost semantics:
 * "unmetered" must stay distinguishable from "genuinely $0".
 *
 * Prices are USD per 1M tokens, verified 2026-09-02 against public pricing
 * pages. If Google changes pricing, override via env instead of redeploying:
 *   SCAN_PRICE_IN_PER_M / SCAN_PRICE_OUT_PER_M (apply to GEMINI_SCAN_MODEL).
 */

import {
  DEFAULT_GEMINI_MODEL,
  vertexGlobalTokenPrice,
} from '@/lib/gemini-model.mjs';

interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

function envPrice(): ModelPrice | null {
  const inPerM = Number(process.env.SCAN_PRICE_IN_PER_M);
  const outPerM = Number(process.env.SCAN_PRICE_OUT_PER_M);
  if (Number.isFinite(inPerM) && inPerM > 0 && Number.isFinite(outPerM) && outPerM > 0) {
    return { inPerM, outPerM };
  }
  return null;
}

export function estimateCostUsd(
  modelId: string,
  tokens: { prompt: number; completion: number; reasoning: number } | null,
  opts?: { tier?: 'standard' | 'flex' }
): number | null {
  if (!tokens) return null;
  const price =
    (modelId === (process.env.GEMINI_SCAN_MODEL || DEFAULT_GEMINI_MODEL) ? envPrice() : null) ??
    vertexGlobalTokenPrice(modelId);
  if (!price) return null;
  // Flex service tier bills at 50% of standard list price (verified against
  // the official Vertex/Gemini-API pricing pages, 2026-08).
  const tierMultiplier = opts?.tier === 'flex' ? 0.5 : 1;
  const inputUsd = (tokens.prompt / 1_000_000) * price.inPerM;
  const outputUsd = ((tokens.completion + tokens.reasoning) / 1_000_000) * price.outPerM;
  return (inputUsd + outputUsd) * tierMultiplier;
}

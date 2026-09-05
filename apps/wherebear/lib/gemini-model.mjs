import { ThinkingLevel } from '@google/genai';

/** Current default for every first-party Gemini call made through Vertex AI. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash';

const INTRO_PRICE_END_MS = Date.UTC(2027, 0, 1);
const INTRO_PRICED_FLASH_MODELS = new Set([
  DEFAULT_GEMINI_MODEL,
  'gemini-3.6-flash',
]);

function baseModelId(modelId) {
  return modelId.split('/').filter(Boolean).at(-1) ?? modelId;
}

/**
 * Gemini 3.7 Flash removed MINIMAL. Keep older model overrides on their former
 * low-latency setting while selecting the lowest supported level for 3.7.
 *
 * @param {string} modelId
 * @returns {ThinkingLevel}
 */
export function lowestSupportedThinkingLevel(modelId) {
  return baseModelId(modelId) === DEFAULT_GEMINI_MODEL
    ? ThinkingLevel.LOW
    : ThinkingLevel.MINIMAL;
}

/**
 * Gemini 3.7 ignores legacy sampling controls. Preserve temperature whenever
 * an older model is selected through an env override or an experiment.
 *
 * @param {string} modelId
 * @param {number} temperature
 * @returns {{ temperature?: number }}
 */
export function temperatureConfigForModel(modelId, temperature) {
  return baseModelId(modelId) === DEFAULT_GEMINI_MODEL ? {} : { temperature };
}

/**
 * Global Standard PayGo list price in USD per 1M tokens. Google offers 3.6
 * and 3.7 Flash introductory pricing through 2026-12-31; calculate it at call
 * time so a long-lived deployment rolls to the published standard price.
 *
 * @param {string} modelId
 * @param {number} [nowMs]
 * @returns {{ inPerM: number, outPerM: number } | null}
 */
export function vertexGlobalTokenPrice(modelId, nowMs = Date.now()) {
  const baseId = baseModelId(modelId);
  if (INTRO_PRICED_FLASH_MODELS.has(baseId)) {
    return nowMs < INTRO_PRICE_END_MS
      ? { inPerM: 0.75, outPerM: 3.75 }
      : { inPerM: 1.5, outPerM: 7.5 };
  }
  if (baseId === 'gemini-3.5-flash') {
    return { inPerM: 1.5, outPerM: 9 };
  }
  return null;
}

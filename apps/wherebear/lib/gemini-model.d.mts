import type { ThinkingLevel } from '@google/genai';

export declare const DEFAULT_GEMINI_MODEL: 'gemini-3.7-flash';

export declare function lowestSupportedThinkingLevel(modelId: string): ThinkingLevel;

export declare function temperatureConfigForModel(
  modelId: string,
  temperature: number,
): { temperature?: number };

export declare function vertexGlobalTokenPrice(
  modelId: string,
  nowMs?: number,
): { inPerM: number; outPerM: number } | null;

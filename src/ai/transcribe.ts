import 'server-only';

import { ThinkingLevel } from '@google/genai';
import { generateContentWithHedge, isAiConfigured } from './client';
import { GEN_MODEL } from './models';
import { type UsageTotals, extractUsage } from './usage';

/**
 * Voice → search phrase (ported from wherebear transcribeAudio). More robust to
 * accents and multilingual input than the Web Speech API. When unsure it
 * returns up to 3 candidates so a noisy-store shopper can tap the right one
 * instead of a single failing result (requirements §4.1).
 */

const PROMPT = `You are the speech-understanding step of a grocery-store "find a product" assistant.

The audio is a SHORT spoken request from a shopper who wants to LOCATE a product. The speaker may have ANY accent and may speak English, Chinese, or mix in a product name from another language. Background store noise is common.

Return ONLY a JSON object (no prose, no code fence):
{ "text": "<best single search phrase>", "candidates": ["<alt 1>", "<alt 2>"] }
- "text": the clean product/search phrase they want. Use grocery knowledge to fix accent-driven mishearings (e.g. "black paper for sushi" → "sushi nori"; "low gun ma" → "Lao Gan Ma"). Do NOT translate — keep the language spoken.
- "candidates": 0–2 ALTERNATIVE interpretations, only if genuinely unsure. Empty when confident.
- If the audio is silent or unintelligible, return { "text": "", "candidates": [] }.`;

export interface TranscribeResult {
  text: string;
  candidates: string[];
  usage: Partial<UsageTotals>;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  langHint?: string
): Promise<TranscribeResult> {
  if (!isAiConfigured()) {
    // Voice needs real recognition; stub can't transcribe audio.
    return { text: '', candidates: [], usage: {} };
  }

  const hint =
    langHint === 'zh'
      ? '\n\nThe UI is Chinese — the speaker likely speaks Chinese or accented English.'
      : langHint === 'en'
        ? '\n\nThe UI is English — the speaker likely speaks English (often accented).'
        : '';

  const result = await generateContentWithHedge(
    {
      model: GEN_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT + hint },
            { inlineData: { data: audioBase64, mimeType } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    },
    4000
  );
  const usage = extractUsage(result, 0);
  try {
    const p = JSON.parse(result.text ?? '{}');
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    const candidates = Array.isArray(p.candidates)
      ? p.candidates
          .filter(
            (s: unknown): s is string =>
              typeof s === 'string' && s.trim().length > 0
          )
          .slice(0, 3)
      : [];
    return { text, candidates, usage };
  } catch {
    return { text: '', candidates: [], usage };
  }
}

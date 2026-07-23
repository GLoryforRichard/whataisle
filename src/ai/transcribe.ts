import 'server-only';

import { chatWithRetry, isAiConfigured, transcribeWithAsr } from './client';
import { ASR_MODEL, GEN_MODEL } from './models';
import { type UsageTotals, extractUsage } from './usage';

/**
 * Voice → search phrase (requirements §4.1), in two steps:
 *   1. ASR_MODEL transcribes the clip, context-biased toward grocery
 *      vocabulary — more robust to accents and multilingual input than the
 *      Web Speech API.
 *   2. GEN_MODEL cleans the raw transcript into a search phrase and proposes
 *      up to 3 candidates when unsure, so a noisy-store shopper can tap the
 *      right one instead of a single failing result.
 * If step 2 fails, the raw transcript is returned as-is (fail-open).
 */

const BIAS_TEXT = `Grocery store product search. The speaker is a shopper asking to find a product in an Asian / international supermarket. Expect brand and product names such as Lao Gan Ma, Samyang Buldak, Kewpie, Nongshim, gochujang, nori, and mixed English/Chinese phrases.`;

const NORMALIZE_PROMPT = `You are the speech-understanding step of a grocery-store "find a product" assistant.

You get the RAW TRANSCRIPT of a SHORT spoken request from a shopper who wants to LOCATE a product. The speaker may have ANY accent and may speak English, Chinese, or mix in a product name from another language; the transcript may contain mishearings.

Return ONLY a JSON object (no prose, no code fence):
{ "text": "<best single search phrase>", "candidates": ["<alt 1>", "<alt 2>"] }
- "text": the clean product/search phrase they want. Use grocery knowledge to fix accent-driven mishearings (e.g. "black paper for sushi" → "sushi nori"; "low gun ma" → "Lao Gan Ma"). Do NOT translate — keep the language spoken.
- "candidates": 0–2 ALTERNATIVE interpretations, only if genuinely unsure. Empty when confident.
- If the transcript is empty or meaningless, return { "text": "", "candidates": [] }.`;

export interface TranscribeResult {
  text: string;
  candidates: string[];
  /** ASR usage — inputTokens carries audio seconds (see usage.ts). */
  asrUsage: Partial<UsageTotals>;
  /** Transcript-cleanup LLM usage. */
  llmUsage: Partial<UsageTotals>;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  langHint?: string
): Promise<TranscribeResult> {
  if (!isAiConfigured()) {
    // Voice needs real recognition; stub can't transcribe audio.
    return { text: '', candidates: [], asrUsage: {}, llmUsage: {} };
  }

  const hint =
    langHint === 'zh'
      ? ' The UI is Chinese — the speaker likely speaks Chinese or accented English.'
      : langHint === 'en'
        ? ' The UI is English — the speaker likely speaks English (often accented).'
        : '';

  const asr = await transcribeWithAsr({
    model: ASR_MODEL,
    audioBase64,
    mimeType,
    biasText: BIAS_TEXT + hint,
  });
  const asrUsage = extractUsage(asr, 0);
  const transcript = asr.text.trim();
  if (!transcript) {
    return { text: '', candidates: [], asrUsage, llmUsage: {} };
  }

  try {
    const result = await chatWithRetry({
      model: GEN_MODEL,
      parts: [
        { text: NORMALIZE_PROMPT + hint },
        { text: `Raw transcript: ${JSON.stringify(transcript)}` },
      ],
      json: true,
      temperature: 0.2,
      thinking: false,
    });
    const llmUsage = extractUsage(result, 0);
    // An empty "text" here is intentional (meaningless transcript) — respect
    // it. Only a garbled/unparseable reply falls through to the raw transcript.
    const p = JSON.parse(result.text || '{}');
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    const candidates = Array.isArray(p.candidates)
      ? p.candidates
          .filter(
            (s: unknown): s is string =>
              typeof s === 'string' && s.trim().length > 0
          )
          .slice(0, 3)
      : [];
    return { text, candidates, asrUsage, llmUsage };
  } catch {
    return { text: transcript, candidates: [], asrUsage, llmUsage: {} };
  }
}

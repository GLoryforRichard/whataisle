import 'server-only';

import { chatWithRetry, isAiConfigured } from './client';
import { GEN_MODEL } from './models';
import { stubAliases } from './stub';
import { type UsageTotals, EMPTY_USAGE, extractUsage } from './usage';

/**
 * Multilingual alias generation (requirements §4.2: a fixed set of aliases —
 * English alternates, Chinese, pinyin/romanization, common misspellings — with
 * no language-configuration options).
 *
 * Unlike wherebear (which relied on a multilingual embedder and generated
 * Chinese only), WhatAisle indexes with pgvector + trigram, so a broader
 * lexical alias corpus directly powers fuzzy/misspelling matches.
 */

export interface ProductAliases {
  /** Alternate English names/brand-variety forms (excludes the canonical name). */
  en: string[];
  /** Simplified (and traditional if clearly different) Chinese names. */
  zh: string[];
  /** Pinyin / romanization of the Chinese names. */
  pinyin: string[];
  /** 2–3 common misspellings customers might type. */
  misspelling: string[];
  /** Best single Chinese display name, or null. */
  nameZh: string | null;
}

const EMPTY_ALIASES: ProductAliases = {
  en: [],
  zh: [],
  pinyin: [],
  misspelling: [],
  nameZh: null,
};

const BATCH_PROMPT = `You generate searchable aliases for grocery products in a bilingual (English + Chinese) supermarket. Shoppers search by typing, so aliases must catch the many ways a real customer might refer to each item.

For each canonical English product name, produce:
- "en": 0–3 alternate English names or brand/variety forms a shopper might type (NOT the canonical name itself, NOT a bare category word).
- "zh": 1–3 Chinese names (simplified; add traditional only if clearly different). [] if there is no natural Chinese name.
- "pinyin": pinyin/romanization of the Chinese names (space-separated syllables), matching "zh" order. [] if "zh" is [].
- "misspelling": 0–3 common misspellings or phonetic guesses a shopper might type (e.g. "gochujang" -> "gochu jang", "kochujang").

Return ONLY a JSON object (no prose, no code fence) keyed by the input canonical name verbatim:
{ "<canonical>": { "en":[...], "zh":[...], "pinyin":[...], "misspelling":[...] } }

Example input: ["Gochujang","Lao Gan Ma Chili Crisp"]
Example output:
{"Gochujang":{"en":["Korean chili paste","red pepper paste"],"zh":["韩式辣椒酱","辣椒酱"],"pinyin":["hán shì là jiāo jiàng","là jiāo jiàng"],"misspelling":["gochu jang","kochujang"]},"Lao Gan Ma Chili Crisp":{"en":["chili crisp","spicy chili oil"],"zh":["老干妈","油辣椒"],"pinyin":["lǎo gān mā","yóu là jiāo"],"misspelling":["lao gama","laoganma"]}}`;

function coerceStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

/**
 * Generate aliases for a batch of canonical names in one call.
 * Returns a map keyed by canonical name.
 */
export async function generateAliasesBatch(
  canonicalNames: string[],
  opts: { shelfContext?: string } = {}
): Promise<{
  aliasesByName: Record<string, ProductAliases>;
  usage: Partial<UsageTotals>;
}> {
  const names = Array.from(new Set(canonicalNames.map((n) => n.trim()))).filter(
    Boolean
  );
  if (names.length === 0) return { aliasesByName: {}, usage: {} };

  if (!isAiConfigured()) {
    const aliasesByName: Record<string, ProductAliases> = {};
    for (const name of names) {
      const s = stubAliases(name);
      aliasesByName[name] = {
        en: s.en,
        zh: s.zh,
        pinyin: s.pinyin,
        misspelling: s.misspelling,
        nameZh: s.zh[0] ?? null,
      };
    }
    return { aliasesByName, usage: { ...EMPTY_USAGE } };
  }

  const result = await chatWithRetry({
    model: GEN_MODEL,
    parts: [
      { text: BATCH_PROMPT },
      {
        text:
          (opts.shelfContext ? `Shelf context: ${opts.shelfContext}\n\n` : '') +
          `Canonical names:\n${JSON.stringify(names)}`,
      },
    ],
    json: true,
    temperature: 0.4,
    thinking: false,
  });
  const usage = extractUsage(result, 0);

  const aliasesByName: Record<string, ProductAliases> = {};
  try {
    const parsed = JSON.parse(result.text || '{}') as Record<string, unknown>;
    for (const name of names) {
      const raw = parsed[name] as Record<string, unknown> | undefined;
      if (!raw) {
        aliasesByName[name] = { ...EMPTY_ALIASES };
        continue;
      }
      const zh = coerceStringArray(raw.zh, 3);
      aliasesByName[name] = {
        en: coerceStringArray(raw.en, 3),
        zh,
        pinyin: coerceStringArray(raw.pinyin, 3),
        misspelling: coerceStringArray(raw.misspelling, 3),
        nameZh: zh[0] ?? null,
      };
    }
  } catch {
    for (const name of names) aliasesByName[name] = { ...EMPTY_ALIASES };
  }
  return { aliasesByName, usage };
}

import 'server-only';

import { type Candidate, searchRepo } from '@/data/search-repo';
import { chatWithHedge, isAiConfigured } from './client';
import { embedQuery } from './embeddings';
import { GEN_MODEL } from './models';
import { extractUsage, recordUsage } from './usage';

/**
 * Fixed (non-agentic) shopper search pipeline:
 *   1. understand  — deterministic script/lang detection (no LLM)
 *   2. retrieve    — hybrid vector + trigram over store memory (RRF + trust boost)
 *   3. synthesize  — bucket keep/guess + pick one of four answer tones
 *
 * Emits step events for the collapsible "thinking" strip (§4.1). Runs fully in
 * degraded/stub mode: without AI, synthesis uses deterministic score-threshold
 * bucketing and template answers.
 */

export type AnswerTone = 'confident' | 'multi' | 'category' | 'none';

export interface SearchStep {
  key: 'understand' | 'search' | 'answer';
  labelEn: string;
  labelZh: string;
}

export interface SearchResult {
  tone: AnswerTone;
  answerEn: string;
  answerZh: string;
  /** Real matches, ranked. */
  candidates: Candidate[];
  /** Location hints when nothing matched (same brand/category). */
  guesses: Candidate[];
  detectedLang: 'en' | 'zh';
  /** True when AI was unavailable and we fell back to plain-text matching. */
  degraded: boolean;
  steps: SearchStep[];
}

const KEEP_SCORE_FLOOR = 0.35; // lexical/vector floor for a deterministic "keep"

function detectLang(query: string): 'en' | 'zh' {
  return /[㐀-鿿]/.test(query) ? 'zh' : 'en';
}

function displayName(c: Candidate, lang: 'en' | 'zh'): string {
  return lang === 'zh' && c.nameZh ? c.nameZh : c.canonicalName;
}

function primaryShelf(c: Candidate): string | null {
  return c.locations[0]?.shelfCode ?? null;
}

const BUCKET_PROMPT = `You are finishing a grocery-store "find the product" search. You get the shopper's QUERY and CANDIDATES (nearest matches in the store's memory — NOT guaranteed correct). Sort candidate indices into buckets:

1. "keep" — candidates that ARE what the shopper asked for (same product; any brand/flavor counts).
2. "guess" — NOT the item, but a location clue: same CATEGORY or same BRAND.
3. discard — unrelated.

Rules: each candidate in exactly one bucket; if any keep, guess may be empty; if no keep, put same-brand/category items in guess; nothing related → both empty.

Return ONLY JSON: {"keep":[indices],"guess":[indices]}`;

async function bucketize(
  query: string,
  pool: Candidate[],
  storeId: string
): Promise<{ keep: Candidate[]; guess: Candidate[] }> {
  // Deterministic default (also the stub/degraded path): keep by score floor.
  // Without an LLM we can't tell a true match from a random nearest-neighbour,
  // so we gate both keeps and guesses by score floors — a query with no lexical
  // hit and only weak vector neighbours becomes a genuine "not found" rather
  // than surfacing noise as category guidance.
  const GUESS_VEC_FLOOR = 0.25;
  const deterministic = () => {
    const keep = pool.filter(
      (c) =>
        (c.lexicalScore ?? 0) >= KEEP_SCORE_FLOOR || (c.vectorScore ?? 0) >= 0.6
    );
    if (keep.length > 0) return { keep: keep.slice(0, 5), guess: [] };
    const guess = pool.filter(
      (c) =>
        (c.lexicalScore ?? 0) > 0 || (c.vectorScore ?? 0) >= GUESS_VEC_FLOOR
    );
    return { keep: [], guess: guess.slice(0, 3) };
  };

  if (!isAiConfigured() || pool.length === 0) return deterministic();

  try {
    const started = Date.now();
    const ctx = JSON.stringify({
      query,
      candidates: pool.map((c, i) => ({
        i,
        name: c.canonicalName,
        category: c.category,
      })),
    });
    const result = await chatWithHedge({
      model: GEN_MODEL,
      parts: [{ text: BUCKET_PROMPT }, { text: ctx }],
      json: true,
      temperature: 0.2,
      thinking: false,
    });
    await recordUsage({
      storeId,
      kind: 'answer',
      model: GEN_MODEL,
      usage: extractUsage(result, 0),
      latencyMs: Date.now() - started,
    });
    const fromIdx = (arr: unknown): Candidate[] =>
      Array.isArray(arr)
        ? arr
            .map((i) => pool[Number(i)])
            .filter((c): c is Candidate => !!c)
            .slice(0, 5)
        : [];
    const p = JSON.parse(result.text || '{}');
    const keep = fromIdx(p.keep);
    const guess = fromIdx(p.guess);
    // Fail-open: a garbled reply falls back to the deterministic bucketing.
    if (keep.length === 0 && guess.length === 0) return deterministic();
    return { keep, guess };
  } catch {
    return deterministic();
  }
}

function buildAnswer(
  tone: AnswerTone,
  query: string,
  keep: Candidate[],
  guess: Candidate[],
  lang: 'en' | 'zh'
): { answerEn: string; answerZh: string } {
  const first = keep[0];
  const firstEnName = first?.canonicalName ?? '';
  const firstZhName = first ? displayName(first, 'zh') : '';
  const shelf = first ? primaryShelf(first) : null;
  const guessShelves = Array.from(
    new Set(guess.map(primaryShelf).filter(Boolean))
  ).join(', ');

  switch (tone) {
    case 'confident':
      return {
        answerEn: `It should be ${firstEnName} on shelf ${shelf}.`,
        answerZh: `应该是 ${shelf} 货架的 ${firstZhName}。`,
      };
    case 'multi':
      return {
        answerEn: `Found a few possibilities — most likely ${firstEnName} on shelf ${shelf}.`,
        answerZh: `找到几个可能，最相符的是 ${shelf} 货架的 ${firstZhName}。`,
      };
    case 'category':
      return {
        answerEn: guessShelves
          ? `We couldn't find "${query}" exactly — items like this are usually near shelf ${guessShelves}.`
          : `We couldn't find "${query}". It may not be stocked here.`,
        answerZh: guessShelves
          ? `没有精确找到“${query}”——类似的商品通常在 ${guessShelves} 货架附近。`
          : `没有找到“${query}”，店里可能没有。`,
      };
    default:
      return {
        answerEn: `We couldn't find "${query}" yet. Try another name, or ask a staff member.`,
        answerZh: `暂时没找到“${query}”。可以换个说法，或询问店员。`,
      };
  }
}

const STEPS: SearchStep[] = [
  {
    key: 'understand',
    labelEn: 'Understanding the question',
    labelZh: '理解问题',
  },
  { key: 'search', labelEn: 'Searching store memory', labelZh: '搜索门店记忆' },
  { key: 'answer', labelEn: 'Picking an answer', labelZh: '给出答案' },
];

export async function runSearch(
  input: { storeId: string; query: string },
  onStep?: (step: SearchStep) => void
): Promise<SearchResult> {
  const lang = detectLang(input.query);

  onStep?.(STEPS[0]);

  // Degrade to lexical-only if the embedder is unavailable (AI down), rather
  // than showing a blank page (requirements §7).
  let embedding: number[] | null = null;
  let degraded = false;
  try {
    embedding = await embedQuery(input.query);
  } catch {
    degraded = true;
  }

  onStep?.(STEPS[1]);
  const pool = await searchRepo(input.storeId).hybridSearch({
    queryText: input.query,
    queryEmbedding: embedding,
  });

  onStep?.(STEPS[2]);
  const { keep, guess } = await bucketize(input.query, pool, input.storeId);

  let tone: AnswerTone;
  if (keep.length >= 2) tone = 'multi';
  else if (keep.length === 1) tone = 'confident';
  else if (guess.length > 0) tone = 'category';
  else tone = 'none';

  const { answerEn, answerZh } = buildAnswer(
    tone,
    input.query,
    keep,
    guess,
    lang
  );

  return {
    tone,
    answerEn,
    answerZh,
    candidates: keep,
    guesses: guess,
    detectedLang: lang,
    degraded,
    steps: STEPS,
  };
}

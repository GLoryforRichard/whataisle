import 'server-only';

import { getDb } from '@/db';
import { type AiUsageKind, aiUsageLog } from '@/db/store.schema';
import { nanoid } from 'nanoid';

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  images: number;
}

export const EMPTY_USAGE: UsageTotals = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  images: 0,
});

export function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    images: (a.images ?? 0) + (b.images ?? 0),
  };
}

/**
 * Pull token counts off a normalized client.ts result, defensively.
 *
 * Convention: for ASR calls (billed per audio second, not per token),
 * inputTokens carries audio seconds when the provider reports them — see
 * transcribeWithAsr in client.ts and ASR_PRICE_PER_SECOND_USD below.
 */
export function extractUsage(
  resp:
    | { usage?: { inputTokens?: number; outputTokens?: number } }
    | undefined
    | null,
  images = 0
): Partial<UsageTotals> {
  return {
    inputTokens: resp?.usage?.inputTokens ?? 0,
    outputTokens: resp?.usage?.outputTokens ?? 0,
    images,
  };
}

/**
 * USD per 1M tokens, DashScope International (Singapore), base tier —
 * verified 2026-07-12 from
 * https://www.alibabacloud.com/help/en/model-studio/model-pricing.
 * Keyed by exact model id; env-overridden models fall back to null (shown as
 * "—" in the back office) rather than a wrong estimate.
 */
const MODEL_PRICING: Record<
  string,
  { inputPerMTok: number; outputPerMTok: number }
> = {
  'qwen3.5-flash': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'qwen3.5-plus': { inputPerMTok: 0.4, outputPerMTok: 2.4 },
  'qwen3-vl-plus': { inputPerMTok: 0.2, outputPerMTok: 1.6 },
  'text-embedding-v4': { inputPerMTok: 0.07, outputPerMTok: 0 },
};

/**
 * qwen3-asr-flash bills per audio second, not per token (output text is
 * free); its usage rows carry audio seconds in inputTokens (see extractUsage
 * above).
 */
const ASR_PRICE_PER_SECOND_USD = 0.000035;

const ASR_MODEL_PREFIX = 'qwen3-asr';

/** Estimated USD cost of a usage total, or null when the price is unknown. */
export function estimateCostUsd(
  model: string,
  usage: UsageTotals
): number | null {
  if (model.startsWith(ASR_MODEL_PREFIX)) {
    return ASR_PRICE_PER_SECOND_USD > 0
      ? usage.inputTokens * ASR_PRICE_PER_SECOND_USD
      : null;
  }
  const p = MODEL_PRICING[model];
  if (!p || (p.inputPerMTok === 0 && p.outputPerMTok === 0)) return null;
  return (
    (usage.inputTokens * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok) /
    1_000_000
  );
}

/**
 * Persist one AI call's usage to ai_usage_log — the per-store cost-accounting
 * hook (requirements §7: cost accounting exists only in the back office).
 * Best-effort: metering never blocks or fails the actual work.
 */
export async function recordUsage(input: {
  storeId: string | null;
  kind: AiUsageKind;
  model: string;
  usage: Partial<UsageTotals>;
  latencyMs: number;
  refId?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(aiUsageLog).values({
      id: nanoid(),
      storeId: input.storeId,
      kind: input.kind,
      model: input.model,
      inputTokens: input.usage.inputTokens ?? 0,
      outputTokens: input.usage.outputTokens ?? 0,
      images: input.usage.images ?? 0,
      latencyMs: input.latencyMs,
      refId: input.refId,
    });
  } catch (err) {
    console.warn('[ai] failed to record usage:', err);
  }
}

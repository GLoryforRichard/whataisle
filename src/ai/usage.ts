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

/** Pull token counts off a Gemini SDK response, defensively. */
export function extractUsage(
  resp:
    | {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }
    | undefined
    | null,
  images = 0
): Partial<UsageTotals> {
  const meta = resp?.usageMetadata;
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    images,
  };
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

'use server';

import { getDb } from '@/db';
import { missInsight } from '@/db/store.schema';
import { storeActionClient } from '@/lib/safe-action';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * One-tap "re-scan reminder": mark a miss as needing a scan (requirements §4.3).
 * When staff photograph the item and save, the miss clears automatically (see
 * clearMissesForProduct in the scan-save path).
 */
export const markNeedsScanAction = storeActionClient
  .schema(z.object({ missId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const db = await getDb();
    await db
      .update(missInsight)
      .set({ classification: 'needs_scan' })
      .where(
        and(
          eq(missInsight.storeId, ctx.store.id),
          eq(missInsight.id, parsedInput.missId)
        )
      );
    return { success: true as const };
  });

/** Mark a miss as "not carried" (a purchasing hint, not a scan task). */
export const markNotCarriedAction = storeActionClient
  .schema(z.object({ missId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const db = await getDb();
    await db
      .update(missInsight)
      .set({ classification: 'not_carried' })
      .where(
        and(
          eq(missInsight.storeId, ctx.store.id),
          eq(missInsight.id, parsedInput.missId)
        )
      );
    return { success: true as const };
  });

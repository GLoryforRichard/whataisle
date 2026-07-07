import 'server-only';

import { getDb } from '@/db';
import { feedbackReport, product, reviewTask } from '@/db/store.schema';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Shopper "I looked — it's not there" feedback (requirements §8).
 *
 * Feedback can only LOWER an answer's confidence tone — it can never modify
 * data directly (a public entry point will be clicked maliciously). After
 * several INDEPENDENT reports on the same product, the product drops to the
 * "doubted" state (shown as "worth double-checking") and a staff review task
 * is created. Every data change still requires staff confirmation.
 */

const INDEPENDENT_REPORTS_THRESHOLD = 3;

export function feedbackRepo(storeId: string) {
  return {
    /**
     * Record one "not there" report, deduped per (product, reporter/day).
     * Returns whether this tipped the product into the doubted state.
     */
    async reportNotThere(input: {
      productId: string;
      reporterHash: string;
    }): Promise<{ recorded: boolean; nowDoubted: boolean }> {
      const db = await getDb();

      // Product must belong to this store (tenant scope).
      const rows = await db
        .select({ id: product.id, confidenceState: product.confidenceState })
        .from(product)
        .where(
          and(
            eq(product.storeId, storeId),
            eq(product.id, input.productId),
            eq(product.status, 'active')
          )
        )
        .limit(1);
      if (rows.length === 0) return { recorded: false, nowDoubted: false };

      // Insert the report; unique (product, reporterHash) makes it idempotent.
      const inserted = await db
        .insert(feedbackReport)
        .values({
          id: nanoid(),
          storeId,
          productId: input.productId,
          reporterHash: input.reporterHash,
        })
        .onConflictDoNothing()
        .returning({ id: feedbackReport.id });
      if (inserted.length === 0) {
        return { recorded: false, nowDoubted: false };
      }

      // Count distinct independent reporters.
      const [{ count }] = (await db.execute(sql`
        SELECT count(*)::int AS count
        FROM feedback_report
        WHERE store_id = ${storeId} AND product_id = ${input.productId}
      `)) as unknown as Array<{ count: number }>;

      let nowDoubted = false;
      if (count >= INDEPENDENT_REPORTS_THRESHOLD) {
        const updated = await db
          .update(product)
          .set({ confidenceState: 'doubted', updatedAt: new Date() })
          .where(
            and(
              eq(product.storeId, storeId),
              eq(product.id, input.productId),
              eq(product.confidenceState, 'normal')
            )
          )
          .returning({ id: product.id });
        if (updated.length > 0) {
          nowDoubted = true;
          // Create a staff review reminder.
          await db.insert(reviewTask).values({
            id: nanoid(),
            storeId,
            productId: input.productId,
            reason: 'shopper_reports_not_there',
          });
        }
      }

      return { recorded: true, nowDoubted };
    },
  };
}

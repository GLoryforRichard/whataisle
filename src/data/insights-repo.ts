import 'server-only';

import { getDb } from '@/db';
import { missInsight, product, searchLog } from '@/db/store.schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

/**
 * Owner insights (requirements §4.3). Statistics EXCLUDE staff test searches
 * and content-safety deflections. The owner view shows usage only — never cost
 * or internal technical metrics (§4.3).
 */
export function insightsRepo(storeId: string) {
  return {
    /** Top shopper searches over the last N days, with how often each hit. */
    async topSearches(days = 7, limit = 10) {
      const db = await getDb();
      const since = new Date(Date.now() - days * 86400_000);
      const rows = (await db.execute(sql`
        SELECT lower(query_text) AS q,
               count(*)::int AS total,
               count(*) FILTER (WHERE answer_tone IN ('confident','multi'))::int AS hits
        FROM search_log
        WHERE store_id = ${storeId}
          AND created_at >= ${since.toISOString()}
          AND is_test = false
          AND is_deflected = false
        GROUP BY lower(query_text)
        ORDER BY total DESC
        LIMIT ${limit}
      `)) as unknown as Array<{ q: string; total: number; hits: number }>;
      return rows.map((r) => ({
        query: r.q,
        total: Number(r.total),
        hits: Number(r.hits),
      }));
    },

    /** Overall hit rate (share of real searches that produced a match). */
    async hitRate(days = 7) {
      const db = await getDb();
      const since = new Date(Date.now() - days * 86400_000);
      const [row] = (await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE answer_tone IN ('confident','multi'))::int AS hits
        FROM search_log
        WHERE store_id = ${storeId}
          AND created_at >= ${since.toISOString()}
          AND is_test = false
          AND is_deflected = false
      `)) as unknown as Array<{ total: number; hits: number }>;
      const total = Number(row?.total ?? 0);
      const hits = Number(row?.hits ?? 0);
      return { total, hits, rate: total ? hits / total : 0 };
    },

    /**
     * Products shoppers couldn't find, split into two lists (§4.3):
     * - not_carried: purchasing hints
     * - needs_scan: probably in stock but not photographed → one-tap re-scan
     * Unclassified misses default to the needs_scan bucket so staff can act.
     */
    async missLists(limit = 20) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(missInsight)
        .where(
          and(eq(missInsight.storeId, storeId), eq(missInsight.status, 'open'))
        )
        .orderBy(desc(missInsight.hitlessCount))
        .limit(limit);
      return {
        needsScan: rows.filter((r) => r.classification !== 'not_carried'),
        notCarried: rows.filter((r) => r.classification === 'not_carried'),
      };
    },

    /** Data-health snapshot: totals, shelf coverage, last scan. */
    async health() {
      const db = await getDb();
      const [{ productCount, lastScan }] = (await db.execute(sql`
        SELECT count(*)::int AS "productCount",
               max(updated_at) AS "lastScan"
        FROM product
        WHERE store_id = ${storeId} AND status = 'active'
      `)) as unknown as Array<{
        productCount: number;
        lastScan: string | null;
      }>;
      return {
        productCount: Number(productCount ?? 0),
        lastScan: lastScan ? new Date(lastScan) : null,
      };
    },

    /**
     * Clear open misses that a just-saved product now answers (§4.3: when staff
     * photograph a previously-missed item and save, it clears automatically).
     * Matches a miss when its query is close (trigram) to a saved name/alias.
     */
    async clearMissesMatching(terms: string[]) {
      if (terms.length === 0) return;
      const db = await getDb();
      const haystack = terms.join(' · ');
      await db.execute(sql`
        UPDATE miss_insight
        SET status = 'cleared'
        WHERE store_id = ${storeId}
          AND status = 'open'
          AND ${haystack} % query_text
      `);
    },

    /** Count of errors corrected (products that left the doubted state) — for
     *  the weekly report's "N errors corrected this week" line. */
    async correctionsThisWeek() {
      const db = await getDb();
      const since = new Date(Date.now() - 7 * 86400_000);
      const rows = await db
        .select({ id: product.id })
        .from(product)
        .where(
          and(
            eq(product.storeId, storeId),
            eq(product.confidenceState, 'normal'),
            gte(product.updatedAt, since)
          )
        );
      return rows.length;
    },
  };
}

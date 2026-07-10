import 'server-only';

import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

/**
 * Cross-tenant platform read models for the back office (requirements §7).
 * These deliberately span stores — they live ONLY in admin-guarded routes,
 * never in the store-facing product.
 */

export interface TenantRow {
  storeId: string;
  handle: string;
  displayName: string;
  status: string;
  productCount: number;
  searches7d: number;
  lastScan: Date | null;
  aiCallsMonth: number;
  /** 0–100 health score. */
  health: number;
  /** Churn-risk reason, or null. */
  churnRisk: string | null;
}

function healthScore(input: {
  searches7d: number;
  productCount: number;
  daysSinceScan: number | null;
}): number {
  let score = 50;
  if (input.productCount > 0) score += 15;
  if (input.searches7d > 0) score += 20;
  if (input.searches7d > 20) score += 10;
  if (input.daysSinceScan !== null && input.daysSinceScan <= 7) score += 5;
  if (input.daysSinceScan !== null && input.daysSinceScan > 30) score -= 30;
  if (input.searches7d === 0) score -= 20;
  return Math.max(0, Math.min(100, score));
}

export async function listTenants(): Promise<TenantRow[]> {
  const db = await getDb();
  const rows = (await db.execute(sql`
    SELECT
      s.id AS "storeId",
      s.handle,
      s.display_name AS "displayName",
      s.status,
      (SELECT count(*) FROM product p WHERE p.store_id = s.id AND p.status = 'active')::int AS "productCount",
      (SELECT count(*) FROM search_log sl WHERE sl.store_id = s.id AND sl.is_test = false AND sl.is_deflected = false AND sl.created_at >= now() - interval '7 days')::int AS "searches7d",
      (SELECT max(sp.processed_at) FROM scan_photo sp WHERE sp.store_id = s.id) AS "lastScan",
      (SELECT count(*) FROM ai_usage_log au WHERE au.store_id = s.id AND au.created_at >= date_trunc('month', now()))::int AS "aiCallsMonth"
    FROM store s
    ORDER BY s.created_at DESC
  `)) as unknown as Array<{
    storeId: string;
    handle: string;
    displayName: string;
    status: string;
    productCount: number;
    searches7d: number;
    lastScan: string | null;
    aiCallsMonth: number;
  }>;

  const now = Date.now();
  return rows.map((r) => {
    const lastScan = r.lastScan ? new Date(r.lastScan) : null;
    const daysSinceScan = lastScan
      ? Math.floor((now - lastScan.getTime()) / 86400_000)
      : null;
    const searches7d = Number(r.searches7d);
    const productCount = Number(r.productCount);

    // Churn-risk rules (§7): proactive retention, not waiting for complaints.
    let churnRisk: string | null = null;
    if (r.status === 'live') {
      if (searches7d === 0) churnRisk = '7 days with zero searches';
      else if (daysSinceScan !== null && daysSinceScan > 30)
        churnRisk = '30 days with zero updates';
      else if (productCount === 0) churnRisk = 'No products scanned yet';
    }

    return {
      storeId: r.storeId,
      handle: r.handle,
      displayName: r.displayName,
      status: r.status,
      productCount,
      searches7d,
      lastScan,
      aiCallsMonth: Number(r.aiCallsMonth),
      health: healthScore({ searches7d, productCount, daysSinceScan }),
      churnRisk,
    };
  });
}

export interface CostRow {
  storeId: string | null;
  displayName: string | null;
  handle: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  /** True when this store's month usage looks abnormal (possible scraping). */
  anomaly: boolean;
}

export async function costByStore(): Promise<CostRow[]> {
  const db = await getDb();
  const rows = (await db.execute(sql`
    SELECT
      au.store_id AS "storeId",
      s.display_name AS "displayName",
      s.handle,
      count(*)::int AS calls,
      coalesce(sum(au.input_tokens),0)::int AS "inputTokens",
      coalesce(sum(au.output_tokens),0)::int AS "outputTokens",
      coalesce(sum(au.images),0)::int AS images
    FROM ai_usage_log au
    LEFT JOIN store s ON s.id = au.store_id
    WHERE au.created_at >= date_trunc('month', now())
    GROUP BY au.store_id, s.display_name, s.handle
    ORDER BY calls DESC
  `)) as unknown as Array<{
    storeId: string | null;
    displayName: string | null;
    handle: string | null;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
  }>;

  const calls = rows.map((r) => Number(r.calls));
  // Anomaly = a store whose call volume is a large multiple of the median
  // (a crude scraping/misuse signal; the platform alerts, never auto-cuts §7).
  const sorted = [...calls].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return rows.map((r) => ({
    storeId: r.storeId,
    displayName: r.displayName,
    handle: r.handle,
    calls: Number(r.calls),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    images: Number(r.images),
    anomaly:
      median > 0 && Number(r.calls) > median * 8 && Number(r.calls) > 100,
  }));
}

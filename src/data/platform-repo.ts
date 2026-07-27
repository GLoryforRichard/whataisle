import 'server-only';

import { estimateCostUsd } from '@/ai/usage';
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
  /**
   * Real month USD reported by the provider (OpenRouter `usage.cost`); null
   * when no call this month reported one.
   */
  meteredCostUsd: number | null;
  /**
   * Estimated month USD for models we only have a published price for
   * (DashScope); null when nothing in this store's usage is priced.
   */
  estimatedCostUsd: number | null;
  /** metered + estimated; null only when both are null (renders as "—"). */
  totalCostUsd: number | null;
  /** Distinct shelf photos scanned this month (the $/scan denominator). */
  scans: number;
  /** totalCostUsd / scans; null when either is unavailable. */
  costPerScanUsd: number | null;
  /** True when this store's month usage looks abnormal (possible scraping). */
  anomaly: boolean;
}

export async function costByStore(): Promise<CostRow[]> {
  const db = await getDb();
  // Grouped by model so each model's pricing applies to its own token counts,
  // then folded into one row per store.
  const rows = (await db.execute(sql`
    SELECT
      au.store_id AS "storeId",
      s.display_name AS "displayName",
      s.handle,
      au.model,
      count(*)::int AS calls,
      coalesce(sum(au.input_tokens),0)::int AS "inputTokens",
      coalesce(sum(au.output_tokens),0)::int AS "outputTokens",
      coalesce(sum(au.images),0)::int AS images,
      sum(au.cost_usd) AS "meteredCostUsd",
      -- Distinct shelf photos this month. Correlated rather than folded into
      -- the GROUP BY because one photo emits scan_rows + scan_detect +
      -- scan_readout rows, usually under the same model id — counting it at
      -- the (store, model) grain would multiply it by the number of stages.
      -- IS NOT DISTINCT FROM: store_id is nullable (the landing try-out row).
      (SELECT count(distinct x.ref_id)
         FROM ai_usage_log x
        WHERE x.store_id IS NOT DISTINCT FROM au.store_id
          AND x.created_at >= date_trunc('month', now())
          AND x.kind IN ('scan_rows','scan_detect','scan_readout')
          AND x.ref_id IS NOT NULL)::int AS "scans"
    FROM ai_usage_log au
    LEFT JOIN store s ON s.id = au.store_id
    WHERE au.created_at >= date_trunc('month', now())
    GROUP BY au.store_id, s.display_name, s.handle, au.model
  `)) as unknown as Array<{
    storeId: string | null;
    displayName: string | null;
    handle: string | null;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    // No coalesce and no ::int on the sum above: an all-NULL group must stay
    // NULL so "unmetered" survives to the UI, and an int cast would truncate
    // sub-dollar spend to zero. postgres.js hands numeric back as a string.
    meteredCostUsd: string | null;
    scans: number;
  }>;

  const byStore = new Map<string, CostRow>();
  for (const r of rows) {
    const key = r.storeId ?? '';
    let row = byStore.get(key);
    if (!row) {
      row = {
        storeId: r.storeId,
        displayName: r.displayName,
        handle: r.handle,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        images: 0,
        meteredCostUsd: null,
        estimatedCostUsd: null,
        totalCostUsd: null,
        // Store-level already (correlated subquery), so assign, never sum.
        scans: Number(r.scans),
        costPerScanUsd: null,
        anomaly: false,
      };
      byStore.set(key, row);
    }
    row.calls += Number(r.calls);
    row.inputTokens += Number(r.inputTokens);
    row.outputTokens += Number(r.outputTokens);
    row.images += Number(r.images);
    // Number(null) is 0, which would turn every unmetered store into a
    // confident "$0.00" — the exact blind spot this column exists to fix.
    const metered = r.meteredCostUsd === null ? null : Number(r.meteredCostUsd);
    if (metered !== null) {
      row.meteredCostUsd = (row.meteredCostUsd ?? 0) + metered;
    } else {
      // Estimate only where the provider didn't meter. Decided per
      // (store, model) group — the GROUP BY grain — so a model that is both
      // metered and in MODEL_PRICING can never be counted twice.
      const cost = estimateCostUsd(r.model, {
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        images: Number(r.images),
      });
      if (cost !== null) {
        row.estimatedCostUsd = (row.estimatedCostUsd ?? 0) + cost;
      }
    }
  }

  const result = [...byStore.values()];

  // Totals first: the anomaly median below is taken over spend, which does not
  // exist until this loop has run.
  for (const r of result) {
    r.totalCostUsd =
      r.meteredCostUsd === null && r.estimatedCostUsd === null
        ? null
        : (r.meteredCostUsd ?? 0) + (r.estimatedCostUsd ?? 0);
    // The number the $999 question actually turns on: cost per shelf photo,
    // times shelves per store per year. Note the numerator includes this
    // store's non-scan spend (search, aliases, voice), so it reads slightly
    // high for a store that also gets heavy shopper traffic.
    r.costPerScanUsd =
      r.totalCostUsd !== null && r.scans > 0 ? r.totalCostUsd / r.scans : null;
  }

  // Anomaly = a store far above the median (a crude scraping/misuse signal;
  // the platform alerts, never auto-cuts, §7).
  //
  // Spend is the better signal now that it is real: 50 dense shelf scans cost
  // far more than 400 cheap searches and would never trip a call-count rule.
  // The call-count rule is kept as an OR so stores running only unpriced,
  // env-overridden models — whose spend reads as $0 — are still covered.
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const callMedian = median(result.map((r) => r.calls));
  const spendMedian = median(result.map((r) => r.totalCostUsd ?? 0));
  // Absolute floors stop the rule firing on noise while the platform is small:
  // with three stores the median is often ~0, and sub-cent months are normal.
  const SPEND_FLOOR_USD = 1;
  const CALL_FLOOR = 100;

  for (const r of result) {
    const spend = r.totalCostUsd ?? 0;
    const spendAnomaly =
      spendMedian > 0 && spend > spendMedian * 8 && spend > SPEND_FLOOR_USD;
    const callAnomaly =
      callMedian > 0 && r.calls > callMedian * 8 && r.calls > CALL_FLOOR;
    r.anomaly = spendAnomaly || callAnomaly;
  }

  // Sort by spend, not call count — now that real dollars exist they are the
  // founder-relevant ordering. Must run after the total loop above.
  return result.sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
}

import 'server-only';

import { createHash } from 'node:crypto';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

/**
 * Fixed-window rate limiter backed by the rate_limit table.
 *
 * Returns true when the request is allowed. The upsert is atomic, so
 * concurrent requests cannot bypass the window.
 */
export async function checkRateLimit(
  key: string,
  opts: { windowSeconds: number; max: number }
): Promise<boolean> {
  const db = await getDb();
  const interval = `${Math.floor(opts.windowSeconds)} seconds`;
  const result = await db.execute(sql`
    INSERT INTO rate_limit (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limit.window_start < now() - ${interval}::interval THEN 1
        ELSE rate_limit.count + 1
      END,
      window_start = CASE
        WHEN rate_limit.window_start < now() - ${interval}::interval THEN now()
        ELSE rate_limit.window_start
      END
    RETURNING count
  `);
  const row = (result as unknown as Array<{ count: number }>)[0];
  return (row?.count ?? 1) <= opts.max;
}

/**
 * Hash an IP for use in rate-limit keys and feedback dedup — raw IPs are
 * never stored.
 */
export function hashIp(ip: string, scope = ''): string {
  return createHash('sha256')
    .update(`${scope}:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

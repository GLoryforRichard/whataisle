const SEARCH_DEDUPE_WINDOW_MS = 60_000;

/** @typedef {'snap' | 'find'} ActivityType */

/**
 * @typedef {object} ActivityItem
 * @property {ActivityType} type
 * @property {string} title
 * @property {string | undefined} [subtitle]
 * @property {string} timestamp
 */

/**
 * @typedef {ActivityItem & {
 *   source: 'snap' | 'search_history' | 'search_logs',
 *   sourceId: string | null,
 *   queryKey: string | null,
 *   found: boolean | null,
 *   timestampMs: number,
 * }} ActivityCandidate
 */

/** @param {unknown} value */
function asRecord(value) {
  return value && typeof value === 'object'
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value */
function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function sourceId(value) {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (record && typeof record.toString === 'function') {
    const id = String(record.toString());
    return id === '[object Object]' ? null : id;
  }
  return null;
}

/** @param {unknown} value */
function timestamp(value) {
  const record = asRecord(value);
  let raw = record && '$date' in record ? record.$date : value;
  const extendedDate = asRecord(raw);
  if (extendedDate && '$numberLong' in extendedDate) raw = extendedDate.$numberLong;
  if (!(raw instanceof Date) && typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (raw === '') return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  const timestampMs = date.getTime();
  if (!Number.isFinite(timestampMs)) return null;
  return { timestamp: date.toISOString(), timestampMs };
}

/** @param {unknown} value */
function queryKey(value) {
  return asNonEmptyString(value)?.toLocaleLowerCase().replace(/\s+/g, ' ') ?? null;
}

/** @param {Record<string, unknown>} row */
function mapSnap(row) {
  const time = timestamp(row.timestamp);
  if (!time) return null;
  const aisle = asNonEmptyString(row.aisle) ?? '—';
  const products = Array.isArray(row.products_detected) ? row.products_detected : [];
  return /** @type {ActivityCandidate} */ ({
    type: 'snap',
    title: `Snapped ${aisle}`,
    subtitle: `${products.length} products`,
    ...time,
    source: 'snap',
    sourceId: sourceId(row._id),
    queryKey: null,
    found: null,
  });
}

/** @param {Record<string, unknown>} row */
function mapSearchHistory(row) {
  const time = timestamp(row.ts);
  const query = asNonEmptyString(row.query) ?? asNonEmptyString(row.original_query);
  if (!time || !query) return null;
  const product = asNonEmptyString(row.product);
  const found = row.found === true || product !== null;
  return /** @type {ActivityCandidate} */ ({
    type: 'find',
    title: found ? `Found "${query}"` : `No result for "${query}"`,
    subtitle: product ?? undefined,
    ...time,
    source: 'search_history',
    sourceId: sourceId(row._id),
    queryKey: queryKey(query),
    found,
  });
}

/** @param {Record<string, unknown>} row */
function mapLegacySearchLog(row) {
  const time = timestamp(row.timestamp);
  const query = asNonEmptyString(row.query) ?? asNonEmptyString(row.original_query);
  if (!time || !query) return null;
  const resultCount = typeof row.results_found === 'number'
    ? row.results_found
    : Number(row.results_found ?? 0);
  const found = Number.isFinite(resultCount) && resultCount > 0;
  return /** @type {ActivityCandidate} */ ({
    type: 'find',
    title: found ? `Found "${query}"` : `No result for "${query}"`,
    subtitle: asNonEmptyString(row.resolved_intent) ?? undefined,
    ...time,
    source: 'search_logs',
    sourceId: sourceId(row._id),
    queryKey: queryKey(query),
    found,
  });
}

/**
 * Merge current and legacy activity schemas. A legacy search is discarded only
 * when a matching current-history entry exists within the same request-sized
 * time window; repeated rows in the current collection remain visible.
 *
 * @param {Record<string, unknown>[]} snaps
 * @param {Record<string, unknown>[]} searchHistory
 * @param {Record<string, unknown>[]} legacySearchLogs
 * @param {number} [limit]
 * @returns {ActivityItem[]}
 */
export function mergeActivity(snaps, searchHistory, legacySearchLogs, limit = 30) {
  const currentFinds = searchHistory.map(mapSearchHistory).filter(Boolean);
  const legacyFinds = legacySearchLogs.map(mapLegacySearchLog).filter(Boolean);

  const dedupedLegacyFinds = legacyFinds.filter((legacy) => !currentFinds.some((current) => (
    legacy.queryKey === current.queryKey
      && legacy.found === current.found
      && Math.abs(legacy.timestampMs - current.timestampMs) <= SEARCH_DEDUPE_WINDOW_MS
  )));

  const candidates = [
    ...snaps.map(mapSnap).filter(Boolean),
    ...currentFinds,
    ...dedupedLegacyFinds,
  ];

  const seen = new Set();
  const deduped = candidates.filter((item) => {
    if (!item.sourceId) return true;
    const key = `${item.source}:${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 30;
  return deduped
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, safeLimit)
    .map(({ type, title, subtitle, timestamp: isoTimestamp }) => ({
      type,
      title,
      ...(subtitle ? { subtitle } : {}),
      timestamp: isoTimestamp,
    }));
}

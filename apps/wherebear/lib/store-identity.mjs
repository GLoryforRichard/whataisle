/** Deployment-bound identity. Never select a database from a request header,
 * query, or body. A second store requires its own database and restricted URI.
 * WhereBear retains its existing DB name to preserve Atlas search indexes.
 */
export const STORE_ID = 'wherebear';
export const CANONICAL_URL = 'https://wherebear.whataisle.com';
export const LEGACY_HOSTS = ['wherebear.help', 'www.wherebear.help'];
export function classifyStoreHost(host) {
  const hostname = (host || '').split(':')[0].toLowerCase();
  if (hostname === 'wherebear.whataisle.com') return 'canonical';
  if (LEGACY_HOSTS.includes(hostname)) return 'legacy';
  if (['localhost', '127.0.0.1', '34.130.157.162.nip.io'].includes(hostname)) return 'local';
  return 'foreign';
}
export function canonicalLocation(pathname, search = '') {
  const target = new URL(CANONICAL_URL);
  target.pathname = pathname;
  target.search = search;
  return target.toString();
}

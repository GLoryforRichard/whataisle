/**
 * Subdomains that can never be registered as store handles
 * (requirements §4.1: reserved words cannot be registered).
 *
 * Handles are permanent, so err on the side of reserving too much:
 * infrastructure names, product surfaces we may want later, and words
 * that could be used to impersonate the platform.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // infrastructure
  'www',
  'api',
  'app',
  'apps',
  'admin',
  'administrator',
  'assets',
  'cdn',
  'static',
  'mail',
  'email',
  'smtp',
  'imap',
  'pop',
  'mx',
  'ns',
  'ns1',
  'ns2',
  'dns',
  'ftp',
  'vpn',
  'localhost',
  // product surfaces
  'help',
  'docs',
  'blog',
  'status',
  'dashboard',
  'portal',
  'account',
  'accounts',
  'auth',
  'login',
  'signup',
  'register',
  'onboarding',
  'billing',
  'payments',
  'pricing',
  'store',
  'stores',
  'staff',
  'shop',
  'shops',
  'search',
  'map',
  'maps',
  'superadmin',
  'internal',
  'ops',
  'staging',
  'dev',
  'test',
  'demo-store',
  // platform identity / impersonation risk
  'whataisle',
  'what-aisle',
  'official',
  'support',
  'security',
  'legal',
  'terms',
  'privacy',
  'abuse',
  'noreply',
  'no-reply',
  'postmaster',
  'webmaster',
  'root',
  'system',
]);

/**
 * Handle rules (requirements §4.1): letters, digits, hyphens only;
 * must start/end alphanumeric; 3–30 chars total.
 */
export const HANDLE_REGEX = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;

export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_REGEX.test(handle);
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle);
}

/**
 * Derive a store handle from the request's Host header, or null when the host
 * is the main site (apex / www), a foreign domain, or a malformed subdomain.
 *
 * THE tenant-identity function (requirements §5). Host is the only acceptable
 * source: it is set by the client's DNS resolution and validated by the load
 * balancer's TLS/vhost routing, so it cannot be forged the way an ordinary
 * request header can. Both the proxy and the server-side store resolver call
 * this — they used to carry byte-identical private copies, which is how they
 * drifted into trusting a spoofable `x-store-handle` header instead.
 *
 * Lives here rather than in store-context.ts because the proxy runs before the
 * server-only/db-importing modules and cannot import them.
 */
export function storeHandleFromHost(host: string | null): string | null {
  if (!host) return null;
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'
  ).toLowerCase();
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === rootDomain || hostname === `www.${rootDomain}`) return null;
  if (!hostname.endsWith(`.${rootDomain}`)) return null;
  const sub = hostname.slice(0, -(rootDomain.length + 1));
  if (!sub || sub === 'www' || sub.includes('.')) return null;
  // Deliberately NOT filtered by isValidHandleFormat: reserved and malformed
  // subdomains must still resolve to "store not found" rather than falling
  // through to the main site. Registration enforces the format; routing only
  // decides whether this host is a store host at all.
  return sub;
}

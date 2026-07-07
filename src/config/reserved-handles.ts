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

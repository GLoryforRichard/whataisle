import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { LOCALES, routing } from './i18n/routing';
import {
  DEFAULT_LOGIN_REDIRECT,
  protectedRoutes,
  routesNotAllowedByLoggedInUsers,
} from './routes';

const intlMiddleware = createMiddleware(routing);

/**
 * Next.js 16 Proxy (formerly Middleware)
 * https://nextjs.org/docs/app/building-your-application/routing/middleware
 *
 * Better Auth integration
 * https://www.better-auth.com/docs/integrations/next#cookie-based-checks-recommended-for-all-versions
 *
 * SECURITY WARNING:
 * The getSessionCookie function ONLY checks for the existence of a session cookie.
 * It does NOT validate the session. Anyone can manually create a cookie to bypass this check.
 * You MUST always validate the session on your server for any protected actions or pages.
 *
 * This proxy only performs fast cookie-based redirection. Actual session validation
 * happens in:
 * - Protected pages: via layout.tsx using getSession() from server
 * - Protected API routes: via auth.api.getSession({ headers })
 * - Server actions: via safe-action middleware
 */
export default async function proxy(req: NextRequest) {
  const { nextUrl } = req;
  console.log('>> proxy start, pathname', nextUrl.pathname);

  // ---------------------------------------------------------------------------
  // Canonical host: pages served from the apex domain must redirect to www.
  // The client bundle bakes NEXT_PUBLIC_BASE_URL (www) into auth API calls, so
  // a page loaded from the apex issues cross-origin requests that the browser
  // blocks — signup/login break entirely. API routes are outside the matcher,
  // so webhooks registered against either host keep working.
  // ---------------------------------------------------------------------------
  const canonicalRedirect = getCanonicalHostRedirect(req);
  if (canonicalRedirect) {
    console.log('<< proxy end, apex host redirected to canonical www host');
    return canonicalRedirect;
  }

  // ---------------------------------------------------------------------------
  // Host routing: <handle>.<root-domain> serves the store's shopper/staff pages.
  // Store subdomains are rewritten to /store/<handle>/* and bypass the locale
  // middleware entirely — store pages read the locale from a cookie instead of
  // the URL, so shoppers see clean URLs like demo.whataisle.com/find?q=milk.
  // ---------------------------------------------------------------------------
  const storeHandle = getStoreHandleFromHost(req.headers.get('host'));
  if (storeHandle) {
    // Reserved subdomains can never be registered, so they fall through to
    // the store lookup and render the "store not found" page (which links to
    // the main site). A cross-host redirect is avoided on purpose: Next
    // normalizes same-origin Locations to relative paths in dev, which loops.
    const url = nextUrl.clone();
    url.pathname = `/store/${storeHandle}${nextUrl.pathname === '/' ? '' : nextUrl.pathname}`;
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-store-handle', storeHandle);
    console.log('<< proxy end, store rewrite:', url.pathname);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  // Direct path access to /store/* on the main host is not a real surface —
  // store pages exist only behind their subdomain rewrite.
  if (nextUrl.pathname.startsWith('/store/')) {
    return NextResponse.redirect(new URL('/', nextUrl));
  }

  // Cookie-based session check for fast redirection
  // WARNING: This only checks cookie existence, NOT validity
  // Actual validation happens in protected layouts and API routes
  const sessionCookie = getSessionCookie(req);
  const isLoggedIn = !!sessionCookie;
  // console.log('proxy, isLoggedIn', isLoggedIn);

  // Get the pathname of the request (e.g. /zh/dashboard to /dashboard)
  const pathnameWithoutLocale = getPathnameWithoutLocale(
    nextUrl.pathname,
    LOCALES
  );

  // If the route can not be accessed by logged in users, redirect if the user is logged in
  if (isLoggedIn) {
    const isNotAllowedRoute = routesNotAllowedByLoggedInUsers.some((route) =>
      new RegExp(`^${route}$`).test(pathnameWithoutLocale)
    );
    if (isNotAllowedRoute) {
      console.log(
        '<< proxy end, not allowed route, already logged in, redirecting to dashboard'
      );
      return NextResponse.redirect(new URL(DEFAULT_LOGIN_REDIRECT, nextUrl));
    }
  }

  const isProtectedRoute = protectedRoutes.some((route) =>
    new RegExp(`^${route}$`).test(pathnameWithoutLocale)
  );
  // console.log('proxy, isProtectedRoute', isProtectedRoute);

  // If the route is a protected route, redirect to login if user is not logged in
  if (!isLoggedIn && isProtectedRoute) {
    let callbackUrl = nextUrl.pathname;
    if (nextUrl.search) {
      callbackUrl += nextUrl.search;
    }
    const encodedCallbackUrl = encodeURIComponent(callbackUrl);
    console.log(
      '<< proxy end, not logged in, redirecting to login, callbackUrl',
      callbackUrl
    );
    return NextResponse.redirect(
      new URL(`/auth/login?callbackUrl=${encodedCallbackUrl}`, nextUrl)
    );
  }

  // Apply intlMiddleware for all routes
  console.log('<< proxy end, applying intlMiddleware');
  return intlMiddleware(req);
}

/**
 * Get the pathname of the request (e.g. /zh/dashboard to /dashboard)
 */
function getPathnameWithoutLocale(pathname: string, locales: string[]): string {
  const localePattern = new RegExp(`^/(${locales.join('|')})/`);
  return pathname.replace(localePattern, '/');
}

/**
 * Redirect apex-host page requests to the canonical www host, or null when no
 * redirect applies. Only active when NEXT_PUBLIC_BASE_URL points at
 * www.<root-domain> (production); in dev and E2E the base URL host equals the
 * root domain, so requests pass through untouched. 308 preserves the method
 * for any in-flight form posts.
 */
function getCanonicalHostRedirect(req: NextRequest): NextResponse | null {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) return null;
  let canonicalHost: string;
  try {
    canonicalHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'
  ).toLowerCase();
  if (canonicalHost !== `www.${rootDomain}`) return null;
  const hostname = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (hostname !== rootDomain) return null;
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, baseUrl);
  return NextResponse.redirect(target, 308);
}

/**
 * Extract the store handle from the request host, or null when the request
 * targets the main site (apex, www, unknown/foreign hosts, nested subdomains).
 *
 * Local dev uses <handle>.localhost:3000 — browsers resolve *.localhost to
 * loopback and treat it as a secure context.
 */
function getStoreHandleFromHost(host: string | null): string | null {
  if (!host) return null;
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'
  ).toLowerCase();
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === rootDomain || hostname === `www.${rootDomain}`) return null;
  if (!hostname.endsWith(`.${rootDomain}`)) return null;
  const sub = hostname.slice(0, -(rootDomain.length + 1));
  if (!sub || sub === 'www' || sub.includes('.')) return null;
  return sub;
}

/**
 * Next.js internationalized routing
 * specify the routes the proxy applies to
 *
 * https://next-intl.dev/docs/routing#base-path
 */
export const config = {
  // The `matcher` is relative to the `basePath`
  matcher: [
    // Match all pathnames except for
    // - if they start with `/api`, `/_next` or `/_vercel`
    // - if they contain a dot (e.g. `favicon.ico`)
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};

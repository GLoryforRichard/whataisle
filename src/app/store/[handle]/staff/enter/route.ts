import {
  STAFF_COOKIE_NAME,
  createStaffCookieValue,
  staffCookieOptions,
  verifyImpersonationToken,
} from '@/lib/staff-auth';
import { getRequestStore } from '@/lib/store-context';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Impersonation hand-off landing (on the store subdomain). Verifies the
 * short-lived signed token from the admin route and sets a flagged
 * (isImpersonation) staff cookie, then sends the admin into the staff area.
 */
export async function GET(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return new NextResponse(null, { status: 404 });
  }

  // On store subdomains the proxy rewrites to an internal apex URL, so req.url
  // has the wrong host — build redirects from the original Host header.
  const host = req.headers.get('host') ?? '';
  const protocol = req.nextUrl.protocol;
  const sameHost = (path: string) => `${protocol}//${host}${path}`;

  const token = new URL(req.url).searchParams.get('t') ?? undefined;
  if (!verifyImpersonationToken(token, store.id)) {
    // Bad/expired token — send to the normal PIN gate.
    return NextResponse.redirect(sameHost('/staff'));
  }

  const res = NextResponse.redirect(sameHost('/staff/scan'));
  res.cookies.set(
    STAFF_COOKIE_NAME,
    createStaffCookieValue(store.id, store.pinVersion, {
      isImpersonation: true,
    }),
    staffCookieOptions
  );
  return res;
}

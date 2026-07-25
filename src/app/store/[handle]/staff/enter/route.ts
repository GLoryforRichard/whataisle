import {
  STAFF_COOKIE_NAME,
  createStaffCookieValue,
  hashImpersonationToken,
  staffCookieOptions,
  verifyImpersonationToken,
} from '@/lib/staff-auth';
import { impersonationRepo } from '@/data/impersonation-repo';
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
  if (!token || !verifyImpersonationToken(token, store.id)) {
    // Bad/expired token — send to the normal PIN gate.
    return NextResponse.redirect(sameHost('/staff'));
  }

  // Burn the grant. A valid signature is necessary but not sufficient: this
  // is what makes the hand-off genuinely one-time, and it is atomic so two
  // simultaneous replays cannot both win.
  const grantId = await impersonationRepo().consume({
    tokenHash: hashImpersonationToken(token),
    storeId: store.id,
  });
  if (!grantId) {
    return NextResponse.redirect(sameHost('/staff'));
  }

  const res = NextResponse.redirect(sameHost('/staff/scan'));
  res.cookies.set(
    STAFF_COOKIE_NAME,
    createStaffCookieValue(store.id, store.pinVersion, {
      isImpersonation: true,
      grantId,
    }),
    { ...staffCookieOptions, maxAge: 60 * 60 }
  );
  return res;
}

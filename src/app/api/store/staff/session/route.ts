import { getDb } from '@/db';
import { auditLog, impersonationGrant } from '@/db/store.schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  STAFF_COOKIE_NAME,
  createStaffCookieValue,
  getStaffSession,
  isValidPinFormat,
  staffCookieOptions,
  verifyPin,
} from '@/lib/staff-auth';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { getRequestStore } from '@/lib/store-context';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Staff PIN session for a store subdomain.
 *
 * POST { pin } — verifies the store PIN and sets the host-only staff cookie.
 * DELETE — clears the staff cookie (exit staff mode).
 *
 * Error responses use stable string codes; the client renders localized,
 * plain-language copy (no technical text reaches staff/shoppers).
 */
export async function POST(req: NextRequest) {
  const store = await getRequestStore();
  if (!store) {
    return NextResponse.json({ error: 'store_not_found' }, { status: 404 });
  }

  const ip = getClientIp(req.headers);
  const allowed = await checkRateLimit(`pin:${store.id}:${hashIp(ip)}`, {
    windowSeconds: 15 * 60,
    max: 5,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 });
  }

  let pin: unknown;
  try {
    ({ pin } = await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (typeof pin !== 'string' || !isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'wrong_pin' }, { status: 401 });
  }

  if (!store.staffPinHash || !(await verifyPin(pin, store.staffPinHash))) {
    return NextResponse.json({ error: 'wrong_pin' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    STAFF_COOKIE_NAME,
    createStaffCookieValue(store.id, store.pinVersion),
    staffCookieOptions
  );
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE_NAME, '', { ...staffCookieOptions, maxAge: 0 });
  return res;
}

/** GET ?exit=1 — clear the staff cookie and return to the shopper page
 *  (used by the impersonation banner's Exit link). Builds the redirect from the
 *  Host header because req.url reflects the internal apex rewrite. */
export async function GET(req: NextRequest) {
  // Close the audit trail. Only 'impersonation.start' was ever recorded, so a
  // session's end — and therefore its real duration — was invisible.
  const store = await getRequestStore();
  if (store) {
    const session = await getStaffSession(store);
    if (session?.isImpersonation) {
      const db = await getDb();
      await db.insert(auditLog).values({
        id: nanoid(),
        storeId: store.id,
        action: 'impersonation.end',
        targetType: 'store',
        targetId: store.id,
        isImpersonation: true,
        detailJson: { grantId: session.grantId },
      });
      if (session.grantId) {
        // The session is over; drop the grant so the cookie cannot be
        // resurrected from a back button or a restored tab.
        await db
          .delete(impersonationGrant)
          .where(eq(impersonationGrant.id, session.grantId));
      }
    }
  }

  const host = req.headers.get('host') ?? '';
  const res = NextResponse.redirect(`${req.nextUrl.protocol}//${host}/`);
  res.cookies.set(STAFF_COOKIE_NAME, '', { ...staffCookieOptions, maxAge: 0 });
  return res;
}

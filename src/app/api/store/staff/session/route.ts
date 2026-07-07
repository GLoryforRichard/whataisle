import {
  STAFF_COOKIE_NAME,
  createStaffCookieValue,
  isValidPinFormat,
  staffCookieOptions,
  verifyPin,
} from '@/lib/staff-auth';
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

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
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

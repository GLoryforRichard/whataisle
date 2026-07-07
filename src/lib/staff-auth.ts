import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Store } from './store-context';

export { hashPin, isValidPinFormat, verifyPin } from './pin';

export const STAFF_COOKIE_NAME = 'wa_staff';
const STAFF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecret(): string {
  const secret =
    process.env.STAFF_COOKIE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('STAFF_COOKIE_SECRET is not set');
  }
  return secret;
}

// -----------------------------------------------------------------------------
// Staff session cookie
//
// Host-only HttpOnly cookie (no Domain attribute), so a cookie issued on
// demo.whataisle.com can never be sent to another store's subdomain.
// Value: <storeId>.<pinVersion>.<expiresAtMs>.<hmac>
// Bumping store.pinVersion invalidates every outstanding cookie.
// -----------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createStaffCookieValue(
  storeId: string,
  pinVersion: number,
  opts?: { isImpersonation?: boolean }
): string {
  const expiresAt = Date.now() + STAFF_COOKIE_MAX_AGE_SECONDS * 1000;
  const flag = opts?.isImpersonation ? 'imp' : 'std';
  const payload = `${storeId}.${pinVersion}.${expiresAt}.${flag}`;
  return `${payload}.${sign(payload)}`;
}

export interface StaffSession {
  storeId: string;
  isImpersonation: boolean;
}

export function verifyStaffCookieValue(
  value: string | undefined,
  currentStore: Pick<Store, 'id' | 'pinVersion'>
): StaffSession | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 5) return null;
  const [storeId, pinVersion, expiresAt, flag, signature] = parts;
  const payload = `${storeId}.${pinVersion}.${expiresAt}.${flag}`;
  const expectedSig = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }
  if (Number(expiresAt) < Date.now()) return null;
  if (storeId !== currentStore.id) return null;
  if (Number(pinVersion) !== currentStore.pinVersion) return null;
  return { storeId, isImpersonation: flag === 'imp' };
}

/**
 * Read and verify the staff session for the given store from request cookies.
 */
export async function getStaffSession(
  currentStore: Pick<Store, 'id' | 'pinVersion'>
): Promise<StaffSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(STAFF_COOKIE_NAME)?.value;
  return verifyStaffCookieValue(value, currentStore);
}

export const staffCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: STAFF_COOKIE_MAX_AGE_SECONDS,
} as const;

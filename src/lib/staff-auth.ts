import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Store } from './store-context';

export { hashPin, isValidPinFormat, verifyPin } from './pin';

export const STAFF_COOKIE_NAME = 'wa_staff';
const STAFF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Impersonation sessions expire in an hour, not thirty days.
 *
 * Support impersonation is a look-at-this-now action; a month-long session on
 * someone else's store is a standing foothold nobody asked for. Staff on their
 * own store still get the full 30 days — they are standing at a till.
 */
const IMPERSONATION_COOKIE_MAX_AGE_SECONDS = 60 * 60;

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
// Value: <storeId>.<pinVersion>.<expiresAtMs>.<flag>.<grantId>.<hmac>
// Bumping store.pinVersion invalidates every outstanding cookie; grantId
// ('-' for ordinary staff) lets a single impersonation session be revoked on
// its own without logging out the store's real staff.
// -----------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createStaffCookieValue(
  storeId: string,
  pinVersion: number,
  opts?: { isImpersonation?: boolean; grantId?: string }
): string {
  const maxAge = opts?.isImpersonation
    ? IMPERSONATION_COOKIE_MAX_AGE_SECONDS
    : STAFF_COOKIE_MAX_AGE_SECONDS;
  const expiresAt = Date.now() + maxAge * 1000;
  const flag = opts?.isImpersonation ? 'imp' : 'std';
  // '-' rather than an empty segment so the split stays a fixed arity.
  const grantId = opts?.grantId ?? '-';
  const payload = `${storeId}.${pinVersion}.${expiresAt}.${flag}.${grantId}`;
  return `${payload}.${sign(payload)}`;
}

export interface StaffSession {
  storeId: string;
  isImpersonation: boolean;
  /** Impersonation grant this session came from, or null for ordinary staff. */
  grantId: string | null;
}

export function verifyStaffCookieValue(
  value: string | undefined,
  currentStore: Pick<Store, 'id' | 'pinVersion'>
): StaffSession | null {
  if (!value) return null;
  const parts = value.split('.');
  // Six segments since grantId was added. Five-segment cookies issued before
  // that fail here and send the holder back to the PIN gate — a one-time
  // re-entry, taken deliberately while no real staff sessions existed.
  if (parts.length !== 6) return null;
  const [storeId, pinVersion, expiresAt, flag, grantId, signature] = parts;
  const payload = `${storeId}.${pinVersion}.${expiresAt}.${flag}.${grantId}`;
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
  return {
    storeId,
    isImpersonation: flag === 'imp',
    grantId: grantId === '-' ? null : grantId,
  };
}

/**
 * Read and verify the staff session for the given store from request cookies.
 *
 * THE single entry point for "is this request staff?" — pages read it directly
 * rather than going through requireStaff(), so anything that must hold for
 * every staff request belongs here, not there.
 */
export async function getStaffSession(
  currentStore: Pick<Store, 'id' | 'pinVersion'>
): Promise<StaffSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(STAFF_COOKIE_NAME)?.value;
  const session = verifyStaffCookieValue(value, currentStore);
  if (!session) return null;

  // Impersonation sessions are individually revocable: dropping the grant row
  // ends exactly that session, without bumping pinVersion and signing out the
  // store's real staff. Costs one indexed lookup, and only for impersonation
  // cookies — ordinary staff traffic never takes this branch.
  if (session.grantId) {
    const { impersonationRepo } = await import('@/data/impersonation-repo');
    if (!(await impersonationRepo().isActive(session.grantId))) return null;
  }

  return session;
}

export const staffCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: STAFF_COOKIE_MAX_AGE_SECONDS,
} as const;

// -----------------------------------------------------------------------------
// Impersonation hand-off token
//
// The staff cookie is host-only, so an admin on the apex can't set it on a
// store subdomain directly. Instead the admin route mints a short-lived signed
// token and redirects to the subdomain, which verifies it and sets a flagged
// (isImpersonation) staff cookie. Every acted-on change is audit-logged.
// -----------------------------------------------------------------------------

export const IMPERSONATION_TTL_MS = 60_000; // 60s — one-time hand-off

/**
 * Server-side handle for a minted hand-off token. The token itself is never
 * stored — only its hash — so a leaked impersonation_grant row cannot be
 * replayed into a session.
 */
export function hashImpersonationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signImpersonationToken(storeId: string): string {
  const expiresAt = Date.now() + IMPERSONATION_TTL_MS;
  const payload = `${storeId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Signature/expiry/audience check only. Single-use enforcement lives in the
 * database (impersonation_grant.consumedAt) — a valid signature is necessary
 * but not sufficient, because the redirect URL carrying this token lands in
 * browser history, referrers and proxy logs.
 */
export function verifyImpersonationToken(
  token: string | undefined,
  storeId: string
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenStoreId, expiresAt, signature] = parts;
  const payload = `${tokenStoreId}.${expiresAt}`;
  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  if (Number(expiresAt) < Date.now()) return false;
  return tokenStoreId === storeId;
}

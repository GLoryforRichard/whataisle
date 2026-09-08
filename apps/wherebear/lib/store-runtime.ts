import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { STORE_ID, CANONICAL_URL, classifyStoreHost } from './store-identity.mjs';
import { getDb } from './mongodb';
import { runtimeDirectory } from './runtime-paths.mjs';
import { verifyStorePin, verifyStoreSession, signStoreSession } from './runtime-crypto.mjs';

export interface StoreRuntimeConfig {
  storeId: string;
  handle: string;
  displayName: string;
  pinHash: string;
  pinVersion: number;
  accessAllowed: boolean;
  setupAllowed: boolean;
  searchReady: boolean;
  serviceEndsAt: string | null;
  recoveryUrl: string;
  managed: boolean;
}
export function isManagedStore() {
  return STORE_ID !== 'wherebear' || Boolean(process.env.STORE_RUNTIME_TOKEN);
}
function platformBase() {
  const url = new URL(process.env.WHATAISLE_PLATFORM_URL || 'https://www.whataisle.com');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Invalid platform URL');
  return url;
}
export async function platformRequest(path: string, body?: unknown) {
  const token = process.env.STORE_RUNTIME_TOKEN;
  if (!token || token.length < 32) throw new Error('Store is not configured');
  return fetch(
    new URL(`/api/runtime/store/${encodeURIComponent(STORE_ID)}${path}`, platformBase()),
    {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
}
export async function getStoreRuntime(): Promise<StoreRuntimeConfig> {
  if (!isManagedStore())
    return {
      storeId: STORE_ID,
      handle: 'wherebear',
      displayName: process.env.STORE_NAME || 'Wherebear',
      pinHash: process.env.STAFF_PIN_HASH || '',
      pinVersion: Number(process.env.STAFF_PIN_VERSION || 1),
      managed: false,
      accessAllowed: true,
      setupAllowed: false,
      searchReady: true,
      serviceEndsAt: null,
      recoveryUrl: 'https://www.whataisle.com/settings/billing',
    };
  if (
    !process.env.MONGODB_DB ||
    !process.env.MONGODB_URI ||
    !process.env.SCAN_JOBS_DIR ||
    !process.env.STORE_CANONICAL_URL
  )
    throw new Error('Store is not configured');
  for (const variable of ['SCAN_JOBS_DIR','MDB_MCP_LOG_PATH'] as const) runtimeDirectory(variable);
  const response = await platformRequest('');
  if (!response.ok) throw new Error('Store configuration unavailable');
  const data = await response.json();
  if (
    data.storeId !== STORE_ID ||
    typeof data.handle !== 'string' ||
    typeof data.displayName !== 'string' ||
    !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(data.pinHash || '') ||
    !Number.isInteger(data.pinVersion) ||
    typeof data.accessAllowed !== 'boolean' ||
    typeof data.setupAllowed !== 'boolean' ||
    new URL(CANONICAL_URL).hostname !== `${data.handle}.whataisle.com`
  )
    throw new Error('Store configuration mismatch');
  // Only the platform's lease-validated activation can enable operations.
  // An older platform response may still open the map, but cannot accept photos.
  return { ...data, managed: true, searchReady: data.searchReady === true };
}
export function sessionSecret() {
  return (
    process.env.STORE_SESSION_SECRET ||
    process.env.STORE_RUNTIME_TOKEN ||
    process.env.STAFF_SESSION_SECRET ||
    ''
  );
}
export function hasStoreSession(
  req: NextRequest,
  config: StoreRuntimeConfig,
  role: 'staff' | 'owner' = 'staff'
) {
  return verifyStoreSession(
    req.cookies.get(role === 'owner' ? 'wa_owner_map' : 'wa_staff')?.value,
    {
      storeId: STORE_ID,
      pinVersion: config.pinVersion,
      role,
      secret: sessionSecret(),
    }
  );
}
export function setStoreSession(
  response: NextResponse,
  config: StoreRuntimeConfig,
  role: 'staff' | 'owner' = 'staff'
) {
  const seconds = role === 'owner' ? 1800 : 7 * 24 * 60 * 60;
  response.cookies.set(
    role === 'owner' ? 'wa_owner_map' : 'wa_staff',
    signStoreSession(
      {
        storeId: STORE_ID,
        pinVersion: config.pinVersion,
        role,
        expiresAt: Date.now() + seconds * 1000,
      },
      sessionSecret()
    ),
    {
      httpOnly: true,
      secure: new URL(CANONICAL_URL).protocol === 'https:' && process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: seconds,
    }
  );
}
export function isSameStoreOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host') || '';
  if (!origin || classifyStoreHost(host) === 'foreign') return false;
  try {
    const source = new URL(origin);
    return (
      source.host === host &&
      (source.protocol === 'https:' ||
        (source.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(source.hostname)))
    );
  } catch {
    return false;
  }
}
export function runtimeDenied(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
/** Persist a bounded store-wide attempt budget. Header spoofing cannot evade it. */
export async function checkStorePin(
  req: NextRequest,
  config: StoreRuntimeConfig,
  pin: unknown
): Promise<NextResponse | null> {
  if (!isSameStoreOrigin(req)) return runtimeDenied(403, 'Please use this store’s own page.');
  const db = await getDb();
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const attempts = db.collection<{ _id: string; attempts: number; expiresAt: Date }>(
    'staff_pin_attempts'
  );
  await attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const result = await attempts.findOneAndUpdate(
    { _id: `${STORE_ID}:${bucket}` },
    { $inc: { attempts: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 5 * 60 * 1000) } },
    { upsert: true, returnDocument: 'after' }
  );
  if ((result?.attempts || 0) > 10)
    return runtimeDenied(429, 'Too many attempts. Try again in five minutes.', {
      code: 'rate_limited',
    });
  const valid = typeof pin === 'string' && verifyStorePin(pin, config.pinHash);
  if (!valid) return runtimeDenied(401, 'Incorrect store password.', { code: 'invalid_pin' });
  // A correct entry releases only its own reservation, never earlier failed guesses.
  await attempts.updateOne({ _id: `${STORE_ID}:${bucket}` }, { $inc: { attempts: -1 } });
  return null;
}
const PUBLIC_APIS = new Set(['/api/search', '/api/voice', '/api/identify', '/api/home-summary']);
const CONFIG_APIS = new Set([
  '/api/runtime/config',
  '/api/runtime/health',
  '/api/staff/session',
  '/api/store-map',
  '/api/store-identity',
  '/api/domain-migration',
  '/api/runtime/owner-entry',
]);
export async function storeOperationsReady(config: StoreRuntimeConfig) {
  if (!config.managed) return true;
  if (!config.searchReady) return false;
  const { getStoreMap } = await import('./store-map');
  return Boolean(await getStoreMap());
}
function preparationRequired() {
  return runtimeDenied(409, 'The store is being prepared. Photo upload and product search are not open yet.', {
    code: 'store_preparing',
  });
}
/** Called inside every route before reading data or accepting a photo. */
export async function authorizeStoreRequest(req: NextRequest): Promise<NextResponse | null> {
  if (classifyStoreHost(req.headers.get('host')) === 'foreign')
    return runtimeDenied(421, 'Store not found');
  const path = new URL(req.url).pathname;
  if (CONFIG_APIS.has(path)) return null; // Their dedicated handlers validate authorization.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameStoreOrigin(req))
    return runtimeDenied(403, 'Please use this store’s own page.');
  try {
    const config = await getStoreRuntime();
    if (!config.accessAllowed)
      return runtimeDenied(402, 'Store subscription is inactive.', {
        recoveryUrl: config.recoveryUrl,
      });
    if (PUBLIC_APIS.has(path)) {
      if (config.managed) {
        const { getStoreMap } = await import('./store-map');
        if (!(await getStoreMap()))
          return runtimeDenied(409, 'Confirm the shelf layout before using the store.', {
            code: 'store_setup_required',
          });
        if (!config.searchReady) return preparationRequired();
      }
      return null;
    }
    if (!hasStoreSession(req, config))
      return runtimeDenied(401, 'Enter the store workspace password.', {
        code: 'staff_auth_required',
      });
    if (!(await storeOperationsReady(config))) return preparationRequired();
    return null;
  } catch {
    return runtimeDenied(503, 'Store temporarily unavailable. Please try again.');
  }
}

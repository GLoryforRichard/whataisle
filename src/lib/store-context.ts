import 'server-only';

import { storeHandleFromHost } from '@/config/reserved-handles';
import { getDb } from '@/db';
import { store } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { cache } from 'react';

export type Store = typeof store.$inferSelect;

/**
 * Look up a store by its subdomain handle. Cached per request.
 */
export const getStoreByHandle = cache(
  async (handle: string): Promise<Store | null> => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(store)
      .where(eq(store.handle, handle.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }
);

/**
 * Look up the store owned by a user (one account = one store). Cached per request.
 */
export const getStoreByOwner = cache(
  async (userId: string): Promise<Store | null> => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(store)
      .where(eq(store.ownerUserId, userId))
      .limit(1);
    return rows[0] ?? null;
  }
);

/**
 * Resolve the store handle for the current request, from the Host header only.
 *
 * This used to prefer an inbound `x-store-handle` header, which the proxy sets
 * on the store-subdomain rewrite. That was a tenant-isolation bypass: the proxy
 * matcher excludes `/api`, so on every store API route the header was neither
 * set nor stripped and any client could forge it to operate on another store
 * (unauthenticated cross-tenant reads, and staff sessions on a store the Host
 * did not own). Host is the only source that cannot be forged this way.
 *
 * Safe for page routes too: `NextResponse.rewrite` forwards the original Host
 * untouched, and no page route calls this — they take `params.handle` from the
 * URL segment the proxy derived from that same Host.
 */
export async function getRequestStoreHandle(): Promise<string | null> {
  const headerStore = await headers();
  return storeHandleFromHost(headerStore.get('host'));
}

/**
 * Resolve a live store for the current request. Onboarding, suspended, closing,
 * and closed stores never expose shopper or staff surfaces.
 *
 * This is the single tenant-resolution point for store API routes: the store
 * a request operates on is ALWAYS derived from the request host, never from
 * client-supplied parameters.
 */
export async function getRequestStore(): Promise<Store | null> {
  const handle = await getRequestStoreHandle();
  if (!handle) return null;
  const found = await getStoreByHandle(handle);
  if (!found || found.status !== 'live') return null;
  return found;
}

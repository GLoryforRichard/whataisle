import 'server-only';

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
 * Resolve the store handle for the current request.
 *
 * Page routes get `x-store-handle` from the proxy rewrite. API routes are
 * excluded from the proxy matcher, so for them the handle is derived from the
 * Host header with the same rules the proxy applies.
 */
export async function getRequestStoreHandle(): Promise<string | null> {
  const headerStore = await headers();
  const fromProxy = headerStore.get('x-store-handle');
  if (fromProxy) return fromProxy;

  const host = headerStore.get('host');
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
 * Resolve the active store for the current request, or null when the request
 * is not on a store subdomain / the store doesn't exist / it is closed.
 *
 * This is the single tenant-resolution point for store API routes: the store
 * a request operates on is ALWAYS derived from the request host, never from
 * client-supplied parameters.
 */
export async function getRequestStore(): Promise<Store | null> {
  const handle = await getRequestStoreHandle();
  if (!handle) return null;
  const found = await getStoreByHandle(handle);
  if (!found || found.status !== 'active') return null;
  return found;
}

/**
 * Like getRequestStore, but throws — for API routes that must be tenant-scoped.
 */
export async function requireRequestStore(): Promise<Store> {
  const found = await getRequestStore();
  if (!found) {
    throw new Error('Store not found for this request');
  }
  return found;
}

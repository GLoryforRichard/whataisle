import 'server-only';

import { getSession } from './server';
import { type Store, getStoreByOwner } from './store-context';

/**
 * Resolve the store owned by the signed-in user, for owner-only API routes.
 * The store always comes from the session — never from a client-supplied id —
 * so an owner can only ever act on their own store.
 */
export async function requireOwnerStore(): Promise<Store | null> {
  const session = await getSession();
  if (!session?.user) return null;
  const store = await getStoreByOwner(session.user.id);
  if (!store || store.status !== 'active') return null;
  return store;
}

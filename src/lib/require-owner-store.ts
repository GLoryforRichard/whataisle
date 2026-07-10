import 'server-only';

import { checkPremiumAccess } from './premium-access';
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
  if (!store || !['onboarding', 'live'].includes(store.status)) return null;
  return store;
}

export type PaidOwnerStoreResult =
  | { store: Store; ownerEmail: string }
  | { error: 'unauthorized' | 'payment_required' };

/**
 * requireOwnerStore + a completed one-time payment. Video upload is the paid
 * deliverable, so its API routes demand payment server-side rather than
 * trusting client-side gating.
 */
export async function requirePaidOwnerStore(): Promise<PaidOwnerStoreResult> {
  const session = await getSession();
  if (!session?.user) return { error: 'unauthorized' };
  const store = await getStoreByOwner(session.user.id);
  if (!store || !['onboarding', 'live'].includes(store.status)) {
    return { error: 'unauthorized' };
  }
  if (!(await checkPremiumAccess(session.user.id))) {
    return { error: 'payment_required' };
  }
  return { store, ownerEmail: session.user.email };
}

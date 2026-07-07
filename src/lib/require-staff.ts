import 'server-only';

import { getStaffSession } from './staff-auth';
import { type Store, getRequestStore } from './store-context';

export interface StaffContext {
  store: Store;
  isImpersonation: boolean;
}

/**
 * Resolve the store from the request host and verify the staff PIN cookie.
 * Returns null when there is no valid staff session for THIS store — the
 * cookie is host-only and bound to (storeId, pinVersion), so a session from
 * another store can never satisfy this.
 */
export async function requireStaff(): Promise<StaffContext | null> {
  const store = await getRequestStore();
  if (!store) return null;
  const session = await getStaffSession(store);
  if (!session) return null;
  return { store, isImpersonation: session.isImpersonation };
}

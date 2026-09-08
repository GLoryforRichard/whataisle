import type { BillingCheckout, OwnerBilling } from './model';

/** The approved shared-VM ceiling includes WhereBear. Raising this requires a
 * capacity decision and matching worker configuration, not a checkout option. */
export const STORE_CAPACITY_LIMIT = 5;

export interface CapacityStore {
  id: string;
  handle: string;
  ownerUserId: string;
  status: string;
  runtimeStatus: string | null;
}

export interface CapacitySnapshot {
  registryHandles: string[];
  stores: CapacityStore[];
}

const archived = (store: CapacityStore) =>
  store.status === 'closed' && store.runtimeStatus === 'archived';

/** Run against one locked database snapshot. A slot changes identity from an
 * owner reservation to a handle at setup, without changing the total. Elapsed
 * checkout timestamps or subscription cancellation never prove resource cleanup.
 */
export function storeCapacityForOwner(
  snapshot: CapacitySnapshot,
  billings: OwnerBilling[],
  checkouts: BillingCheckout[],
  ownerId: string
) {
  const slots = new Set<string>();
  const ownerSlots = new Map<string, string>();
  const storesByOwner = new Map(
    snapshot.stores.map((store) => [store.ownerUserId, store])
  );
  const handleKey = (handle: string) => `store:${handle.toLowerCase()}`;
  for (const handle of snapshot.registryHandles) {
    const store = snapshot.stores.find(
      (item) => item.handle.toLowerCase() === handle.toLowerCase()
    );
    // WhereBear is the permanent customer-1 reservation on this shared VM.
    if (handle.toLowerCase() === 'wherebear' || !store || !archived(store))
      slots.add(handleKey(handle));
  }
  for (const store of snapshot.stores) {
    if (archived(store)) continue;
    const key = handleKey(store.handle);
    slots.add(key);
    ownerSlots.set(store.ownerUserId, key);
  }
  const reserveOwner = (id: string) => {
    const key = ownerSlots.get(id) ?? `owner:${id}`;
    slots.add(key);
    ownerSlots.set(id, key);
  };
  for (const billing of billings) {
    const store = storesByOwner.get(billing.ownerUserId);
    if (billing.lastPaidAt && (!store || !archived(store)))
      reserveOwner(billing.ownerUserId);
  }
  for (const checkout of checkouts) {
    if (checkout.status === 'reserved' || checkout.status === 'open') {
      reserveOwner(checkout.ownerUserId);
    } else if (checkout.status === 'paid') {
      const store = storesByOwner.get(checkout.ownerUserId);
      if (!store || !archived(store)) reserveOwner(checkout.ownerUserId);
    }
  }
  return {
    used: slots.size,
    limit: STORE_CAPACITY_LIMIT,
    ownerHasSlot: ownerSlots.has(ownerId),
  };
}

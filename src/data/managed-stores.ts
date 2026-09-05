import 'server-only';

import registry from '../../stores/registry.json';

/** Deployment registry, not a product database. No credentials belong here.
 * Each runtime has its own MongoDB database and credentials. Do not point a
 * second store at WhereBear's database or expose records across store hosts.
 */
export const managedStores = registry;

export async function getManagedStoreStatus(store: (typeof registry)[number]) {
  try {
    const identityResponse = await fetch(`${store.url}/api/store-identity`, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!identityResponse.ok) return null;
    const identity = await identityResponse.json();
    if (identity.storeId !== store.id || identity.canonicalUrl !== store.url) {
      return null;
    }
    const response = await fetch(`${store.url}/api/home-summary`, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const summary = await response.json();
    if (!summary.ok || !Number.isFinite(summary.products)) return null;
    return { products: summary.products as number };
  } catch {
    // A DNS/certificate or store outage must not take down the platform admin.
    return null;
  }
}

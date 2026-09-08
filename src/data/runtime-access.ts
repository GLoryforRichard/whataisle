import 'server-only';

import { getDb } from '@/db';
import { storeRuntime } from '@/db/runtime.schema';
import { store } from '@/db/store.schema';
import { matchesSecret } from '@/lib/store-secrets';
import { eq } from 'drizzle-orm';

export async function authenticateStoreRuntime(
  storeId: string,
  request: Request
) {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.length > 256) return null;
  const db = await getDb();
  const [row] = await db
    .select({ tenant: store, runtime: storeRuntime })
    .from(store)
    .innerJoin(storeRuntime, eq(storeRuntime.storeId, store.id))
    .where(eq(store.id, storeId));
  if (
    !row ||
    row.runtime.status === 'archived' ||
    row.tenant.status === 'closed' ||
    !matchesSecret(auth.slice(7), row.runtime.runtimeTokenHash)
  )
    return null;
  return row;
}

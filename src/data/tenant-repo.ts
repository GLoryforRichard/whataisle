import 'server-only';

import { getDb } from '@/db';
import { floorMap, shelf } from '@/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Tenant-scoped data access.
 *
 * THE tenant-isolation boundary (requirements §5: a shopper seeing another
 * store's shelf number is the worst-case failure). Every method binds the
 * storeId captured at construction — callers can never pass a store id per
 * query, so a forgotten WHERE clause cannot leak across tenants.
 *
 * All access to tenant tables (shelf, floorMap, product, ... ) must go
 * through this module; only `store` lookups live outside (store-context.ts).
 */
export function tenantRepo(storeId: string) {
  return {
    storeId,

    // ---------------------------------------------------------------------
    // Shelves
    // ---------------------------------------------------------------------
    async listShelves() {
      const db = await getDb();
      return db
        .select()
        .from(shelf)
        .where(and(eq(shelf.storeId, storeId), eq(shelf.status, 'active')))
        .orderBy(asc(shelf.sortOrder), asc(shelf.code));
    },

    async getShelfByCode(code: string) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(shelf)
        .where(
          and(
            eq(shelf.storeId, storeId),
            eq(shelf.code, code),
            eq(shelf.status, 'active')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createShelf(input: {
      code: string;
      label?: string;
      labelZh?: string;
      sortOrder?: number;
    }) {
      const db = await getDb();
      const rows = await db
        .insert(shelf)
        .values({
          id: nanoid(),
          storeId,
          code: input.code,
          label: input.label,
          labelZh: input.labelZh,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return rows[0];
    },

    // ---------------------------------------------------------------------
    // Floor map
    // ---------------------------------------------------------------------
    async getFloorMap() {
      const db = await getDb();
      const rows = await db
        .select()
        .from(floorMap)
        .where(eq(floorMap.storeId, storeId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}

export type TenantRepo = ReturnType<typeof tenantRepo>;

import 'server-only';

import { getDb } from '@/db';
import {
  EMBEDDING_DIM,
  type ConfidenceState,
  type ProductStatus,
  product,
  productAlias,
  productLocation,
  shelf,
} from '@/db/store.schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Tenant-scoped product/alias/location data access. Every method binds the
 * storeId captured at construction (see tenant-repo.ts for the rationale).
 */
export function productRepo(storeId: string) {
  return {
    storeId,

    async findByCanonicalNames(names: string[]) {
      if (names.length === 0) return [];
      const db = await getDb();
      return db
        .select()
        .from(product)
        .where(
          and(
            eq(product.storeId, storeId),
            inArray(product.canonicalName, names)
          )
        );
    },

    async listByShelf(shelfId: string) {
      const db = await getDb();
      return db
        .select({
          product,
          locationId: productLocation.id,
          seenCount: productLocation.seenCount,
          side: productLocation.side,
        })
        .from(productLocation)
        .innerJoin(product, eq(productLocation.productId, product.id))
        .where(
          and(
            eq(productLocation.storeId, storeId),
            eq(productLocation.shelfId, shelfId),
            eq(productLocation.status, 'active'),
            eq(product.status, 'active')
          )
        );
    },

    async getAliases(productId: string) {
      const db = await getDb();
      return db
        .select()
        .from(productAlias)
        .where(
          and(
            eq(productAlias.storeId, storeId),
            eq(productAlias.productId, productId)
          )
        );
    },

    /**
     * Insert a new product (with embedding + aliases) or, if the canonical
     * name already exists, bump its evidence count and refresh the embedding.
     * Records/refreshes the location on the given shelf (seen N× per §2/§8).
     * Returns the product id and whether it was newly created.
     */
    async upsertFromScan(input: {
      canonicalName: string;
      nameZh: string | null;
      category: string | null;
      searchText: string;
      embedding: number[];
      thumbnailKey: string | null;
      aliases: Array<{ alias: string; lang: string; source?: string }>;
      shelfId: string;
      side?: 'L' | 'R' | null;
    }): Promise<{ productId: string; created: boolean }> {
      const db = await getDb();
      const embeddingValue = assertDim(input.embedding);

      const existing = await db
        .select({ id: product.id, evidenceCount: product.evidenceCount })
        .from(product)
        .where(
          and(
            eq(product.storeId, storeId),
            eq(product.canonicalName, input.canonicalName)
          )
        )
        .limit(1);

      let productId: string;
      let created: boolean;

      if (existing.length > 0) {
        productId = existing[0].id;
        created = false;
        await db
          .update(product)
          .set({
            evidenceCount: existing[0].evidenceCount + 1,
            nameZh: input.nameZh ?? undefined,
            category: input.category ?? undefined,
            searchText: input.searchText,
            embedding: embeddingValue,
            thumbnailKey: input.thumbnailKey ?? undefined,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(product.id, productId));
        // Refresh aliases: replace with the newly generated set.
        await db
          .delete(productAlias)
          .where(
            and(
              eq(productAlias.storeId, storeId),
              eq(productAlias.productId, productId)
            )
          );
      } else {
        productId = nanoid();
        created = true;
        await db.insert(product).values({
          id: productId,
          storeId,
          canonicalName: input.canonicalName,
          nameZh: input.nameZh,
          category: input.category,
          searchText: input.searchText,
          embedding: embeddingValue,
          thumbnailKey: input.thumbnailKey,
        });
      }

      if (input.aliases.length > 0) {
        await db.insert(productAlias).values(
          input.aliases.map((a) => ({
            id: nanoid(),
            storeId,
            productId,
            alias: a.alias,
            lang: a.lang as 'en' | 'zh' | 'pinyin' | 'misspelling',
            source: (a.source ?? 'ai') as 'ai' | 'manual',
          }))
        );
      }

      // Upsert the location: unique on (product, shelf, side). On re-scan of the
      // same location, bump seenCount and lastSeenAt.
      await db
        .insert(productLocation)
        .values({
          id: nanoid(),
          storeId,
          productId,
          shelfId: input.shelfId,
          side: input.side ?? null,
          seenCount: 1,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [
            productLocation.productId,
            productLocation.shelfId,
            productLocation.side,
          ],
          set: {
            seenCount: sql`${productLocation.seenCount} + 1`,
            lastSeenAt: new Date(),
            status: 'active',
          },
        });

      return { productId, created };
    },

    async updateProduct(
      productId: string,
      patch: {
        canonicalName?: string;
        nameZh?: string | null;
        category?: string | null;
        status?: ProductStatus;
        confidenceState?: ConfidenceState;
        searchText?: string;
        embedding?: number[];
      }
    ) {
      const db = await getDb();
      await db
        .update(product)
        .set({
          canonicalName: patch.canonicalName,
          nameZh: patch.nameZh,
          category: patch.category,
          status: patch.status,
          confidenceState: patch.confidenceState,
          searchText: patch.searchText,
          embedding: patch.embedding ? assertDim(patch.embedding) : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(product.storeId, storeId), eq(product.id, productId)));
    },

    async softDeleteProduct(productId: string) {
      const db = await getDb();
      await db
        .update(product)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(and(eq(product.storeId, storeId), eq(product.id, productId)));
    },

    async deleteLocation(locationId: string) {
      const db = await getDb();
      await db
        .update(productLocation)
        .set({ status: 'deleted' })
        .where(
          and(
            eq(productLocation.storeId, storeId),
            eq(productLocation.id, locationId)
          )
        );
    },

    /** Owner-only: clear every product location on a shelf. Returns count. */
    async clearShelf(shelfId: string): Promise<number> {
      const db = await getDb();
      const affected = await db
        .update(productLocation)
        .set({ status: 'deleted' })
        .where(
          and(
            eq(productLocation.storeId, storeId),
            eq(productLocation.shelfId, shelfId),
            eq(productLocation.status, 'active')
          )
        )
        .returning({ id: productLocation.id });
      return affected.length;
    },

    async countActiveOnShelf(shelfId: string): Promise<number> {
      const db = await getDb();
      const rows = await db
        .select({ id: productLocation.id })
        .from(productLocation)
        .where(
          and(
            eq(productLocation.storeId, storeId),
            eq(productLocation.shelfId, shelfId),
            eq(productLocation.status, 'active')
          )
        );
      return rows.length;
    },

    async resolveShelf(shelfId: string) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(shelf)
        .where(
          and(
            eq(shelf.storeId, storeId),
            eq(shelf.id, shelfId),
            eq(shelf.status, 'active')
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
  };
}

export type ProductRepo = ReturnType<typeof productRepo>;

/** Validate embedding dimensionality before it reaches the vector column. */
function assertDim(vec: number[]): number[] {
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding must be ${EMBEDDING_DIM} dims, got ${vec.length}`
    );
  }
  return vec;
}

/** Format a JS number[] as a pgvector literal string (for raw SQL search). */
export function toVectorLiteral(vec: number[]): string {
  return `[${assertDim(vec).join(',')}]`;
}

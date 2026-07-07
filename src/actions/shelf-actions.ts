'use server';

import { productRepo } from '@/data/product-repo';
import { tenantRepo } from '@/data/tenant-repo';
import { storeActionClient } from '@/lib/safe-action';
import { z } from 'zod';

/**
 * Shelf and product management (requirements §4.2). Destructive actions
 * (clear a shelf) are owner-account only — these actions all run through
 * storeActionClient, which requires the owner session.
 */

export const addShelfAction = storeActionClient
  .schema(
    z.object({
      code: z.string().trim().min(1).max(20),
      label: z.string().trim().max(60).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const existing = await tenantRepo(ctx.store.id).getShelfByCode(
      parsedInput.code
    );
    if (existing) {
      return { success: false as const, error: 'exists' as const };
    }
    await tenantRepo(ctx.store.id).createShelf({
      code: parsedInput.code,
      label: parsedInput.label,
    });
    return { success: true as const };
  });

export const deleteProductAction = storeActionClient
  .schema(z.object({ productId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    await productRepo(ctx.store.id).softDeleteProduct(parsedInput.productId);
    return { success: true as const };
  });

export const clearShelfAction = storeActionClient
  .schema(z.object({ shelfId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const count = await productRepo(ctx.store.id).clearShelf(
      parsedInput.shelfId
    );
    return { success: true as const, count };
  });

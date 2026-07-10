'use server';

import { getDb } from '@/db';
import { auditLog, store, storeTermsAcceptance } from '@/db/schema';
import {
  isReservedHandle,
  isValidHandleFormat,
} from '@/config/reserved-handles';
import { TERMS_VERSION } from '@/config/terms';
import { userActionClient } from '@/lib/safe-action';
import { getStoreByOwner } from '@/lib/store-context';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const schema = z.object({
  handle: z.string().min(3).max(30),
  displayName: z.string().trim().min(1).max(100),
  termsAccepted: z.literal(true),
});

/**
 * Create the user's store with its permanent handle
 * (requirements §4.1: once chosen, the subdomain can never be changed —
 * the UI shows a second confirmation before calling this).
 */
export const createStoreAction = userActionClient
  .schema(schema)
  .action(async ({ parsedInput, ctx }) => {
    const handle = parsedInput.handle.toLowerCase();

    if (!isValidHandleFormat(handle)) {
      return { success: false as const, error: 'format' as const };
    }
    if (isReservedHandle(handle)) {
      return { success: false as const, error: 'reserved' as const };
    }

    const existingStore = await getStoreByOwner(ctx.user.id);
    if (existingStore) {
      return { success: false as const, error: 'already_has_store' as const };
    }

    const db = await getDb();
    const taken = await db
      .select({ id: store.id })
      .from(store)
      .where(eq(store.handle, handle))
      .limit(1);
    if (taken.length > 0) {
      return { success: false as const, error: 'taken' as const };
    }

    const storeId = nanoid();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(store).values({
          id: storeId,
          handle,
          ownerUserId: ctx.user.id,
          displayName: parsedInput.displayName,
          status: 'onboarding',
        });
        await tx.insert(storeTermsAcceptance).values({
          id: nanoid(),
          userId: ctx.user.id,
          termsVersion: TERMS_VERSION,
        });
        await tx.insert(auditLog).values({
          id: nanoid(),
          actorUserId: ctx.user.id,
          storeId,
          action: 'store.create',
          targetType: 'store',
          targetId: storeId,
          detailJson: { handle, displayName: parsedInput.displayName },
        });
      });
    } catch (error) {
      // Unique-violation race: someone claimed the handle between check and insert.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        return { success: false as const, error: 'taken' as const };
      }
      throw error;
    }

    return { success: true as const, handle };
  });

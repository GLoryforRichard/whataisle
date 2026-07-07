'use server';

import { getDb } from '@/db';
import { store } from '@/db/schema';
import {
  isReservedHandle,
  isValidHandleFormat,
} from '@/config/reserved-handles';
import { userActionClient } from '@/lib/safe-action';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  handle: z.string().min(1).max(64),
});

export type HandleCheckResult =
  | { available: true }
  | { available: false; reason: 'format' | 'reserved' | 'taken' };

/**
 * Live availability check for the store-handle picker
 * (requirements §4.1: availability is validated in real time at signup).
 */
export const checkStoreHandleAction = userActionClient
  .schema(schema)
  .action(async ({ parsedInput }): Promise<HandleCheckResult> => {
    const handle = parsedInput.handle.toLowerCase();

    if (!isValidHandleFormat(handle)) {
      return { available: false, reason: 'format' };
    }
    if (isReservedHandle(handle)) {
      return { available: false, reason: 'reserved' };
    }

    const db = await getDb();
    const existing = await db
      .select({ id: store.id })
      .from(store)
      .where(eq(store.handle, handle))
      .limit(1);
    if (existing.length > 0) {
      return { available: false, reason: 'taken' };
    }

    return { available: true };
  });

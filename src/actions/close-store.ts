'use server';

import { getDb } from '@/db';
import { store } from '@/db/store.schema';
import { sendEmail } from '@/mail';
import { storeActionClient } from '@/lib/safe-action';
import { eq } from 'drizzle-orm';

/**
 * Close a store — deletes ALL data immediately, no retention (requirements §7).
 * The confirmation name must exactly match, and the UI shows a double
 * confirmation and steers the owner to export first. A completion notice is
 * sent once deletion is done.
 *
 * Deletion cascades from the store row (every tenant table references
 * store.id ON DELETE CASCADE), so removing the store removes everything.
 */
import { z } from 'zod';

export const closeStoreAction = storeActionClient
  .schema(z.object({ confirmName: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.confirmName.trim() !== ctx.store.displayName) {
      return { success: false as const, error: 'name_mismatch' as const };
    }

    const db = await getDb();
    const ownerEmail = ctx.user.email;
    const storeName = ctx.store.displayName;

    // Cascade delete: removing the store removes products, photos metadata,
    // map, logs — everything.
    await db.delete(store).where(eq(store.id, ctx.store.id));

    // Completion notice (best-effort — deletion already succeeded).
    await sendEmail({
      to: ownerEmail,
      subject: `${storeName} has been closed`,
      html: `<div style="font-family:system-ui,sans-serif">
        <p>Your store <strong>${storeName}</strong> has been permanently closed and all its data deleted, as you requested.</p>
        <p>Thank you for using WhatAisle.</p>
      </div>`,
    }).catch(() => {});

    return { success: true as const };
  });

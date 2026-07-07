'use server';

import { getDb } from '@/db';
import { store } from '@/db/store.schema';
import { hashPin, isValidPinFormat } from '@/lib/pin';
import { storeActionClient } from '@/lib/safe-action';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Owner store-settings actions. All bind the store from the session
 * (storeActionClient), so an owner can only edit their own store. The store
 * handle is intentionally NOT editable — it is permanent (§4.1). The display
 * name and announcements are editable anytime (§9).
 */

const hoursSchema = z
  .array(
    z.object({
      day: z.number().int().min(0).max(6),
      open: z.string().max(5),
      close: z.string().max(5),
      closed: z.boolean().optional(),
    })
  )
  .max(7)
  .optional();

export const updateStoreProfileAction = storeActionClient
  .schema(
    z.object({
      displayName: z.string().trim().min(1).max(100),
      displayNameZh: z.string().trim().max(100).nullable().optional(),
      announcement: z.string().trim().max(500).nullable().optional(),
      announcementZh: z.string().trim().max(500).nullable().optional(),
      openingHours: hoursSchema,
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const db = await getDb();
    await db
      .update(store)
      .set({
        displayName: parsedInput.displayName,
        displayNameZh: parsedInput.displayNameZh || null,
        announcement: parsedInput.announcement || null,
        announcementZh: parsedInput.announcementZh || null,
        openingHours: parsedInput.openingHours ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(store.id, ctx.store.id));
    return { success: true as const };
  });

export const setStaffPinAction = storeActionClient
  .schema(z.object({ pin: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    if (!isValidPinFormat(parsedInput.pin)) {
      return { success: false as const, error: 'format' as const };
    }
    const db = await getDb();
    // Bumping pinVersion invalidates every outstanding staff cookie.
    await db
      .update(store)
      .set({
        staffPinHash: await hashPin(parsedInput.pin),
        pinVersion: ctx.store.pinVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(store.id, ctx.store.id));
    return { success: true as const };
  });

'use server';

import { mappingRepo } from '@/data/mapping-repo';
import { storeActionClient } from '@/lib/safe-action';
import { z } from 'zod';

/**
 * Owner map review actions (requirements §6). All bind the store from the
 * session via storeActionClient, so an owner can only act on their own map.
 */

export const confirmMapAction = storeActionClient
  .schema(z.object({}))
  .action(async ({ ctx }) => {
    await mappingRepo(ctx.store.id).confirmMap();
    return { success: true as const };
  });

export const returnMapAction = storeActionClient
  .schema(z.object({ note: z.string().trim().min(1).max(500) }))
  .action(async ({ parsedInput, ctx }) => {
    await mappingRepo(ctx.store.id).returnMap(parsedInput.note);
    return { success: true as const };
  });

export const requestLayoutUpdateAction = storeActionClient
  .schema(z.object({ note: z.string().trim().min(1).max(500) }))
  .action(async ({ parsedInput, ctx }) => {
    await mappingRepo(ctx.store.id).requestLayoutUpdate(parsedInput.note);
    return { success: true as const };
  });

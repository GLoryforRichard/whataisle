'use server';

import { publishFloorMap } from '@/data/mapping-repo';
import type { FloorMapJson } from '@/db/store.schema';
import { adminActionClient } from '@/lib/safe-action';
import { z } from 'zod';

const shapeSchema = z.object({
  shelfCode: z.string().trim().min(1).max(20),
  kind: z.enum(['rect', 'polygon']),
  coords: z.array(z.number()).min(2).max(64),
  labelPos: z.tuple([z.number(), z.number()]).optional(),
  sides: z.boolean().optional(),
});

const schema = z.object({
  storeId: z.string().min(1),
  ticketId: z.string().min(1),
  mapJson: z.object({
    viewBox: z.object({ width: z.number(), height: z.number() }),
    shapes: z.array(shapeSchema).min(1).max(500),
  }),
});

/**
 * Publish a hand-drawn floor map to a store (founder/admin only). The map is
 * saved as an awaiting-confirm draft; the owner reviews and confirms.
 */
export const publishMapAction = adminActionClient
  .schema(schema)
  .action(async ({ parsedInput, ctx }) => {
    await publishFloorMap({
      storeId: parsedInput.storeId,
      ticketId: parsedInput.ticketId,
      mapJson: parsedInput.mapJson as FloorMapJson,
      actorUserId: ctx.user.id,
    });
    return { success: true as const };
  });

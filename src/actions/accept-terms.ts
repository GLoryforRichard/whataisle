'use server';

import { TERMS_VERSION } from '@/config/terms';
import { getDb } from '@/db';
import { storeTermsAcceptance } from '@/db/store.schema';
import { userActionClient } from '@/lib/safe-action';
import { nanoid } from 'nanoid';
import { z } from 'zod';

/**
 * Record acceptance of the current terms version (requirements §10: updated
 * terms require re-confirmation, with the version recorded).
 */
export const acceptTermsAction = userActionClient
  .schema(z.object({}))
  .action(async ({ ctx }) => {
    const db = await getDb();
    await db.insert(storeTermsAcceptance).values({
      id: nanoid(),
      userId: ctx.user.id,
      termsVersion: TERMS_VERSION,
    });
    return { success: true as const };
  });

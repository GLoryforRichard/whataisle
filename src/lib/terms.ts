import 'server-only';

import { TERMS_VERSION } from '@/config/terms';
import { getDb } from '@/db';
import { storeTermsAcceptance } from '@/db/store.schema';
import { and, eq } from 'drizzle-orm';

/**
 * Whether the user has accepted the CURRENT terms version. Updated terms
 * require re-confirmation (requirements §10).
 */
export async function hasAcceptedCurrentTerms(
  userId: string
): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: storeTermsAcceptance.id })
    .from(storeTermsAcceptance)
    .where(
      and(
        eq(storeTermsAcceptance.userId, userId),
        eq(storeTermsAcceptance.termsVersion, TERMS_VERSION)
      )
    )
    .limit(1);
  return rows.length > 0;
}

import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '@/db';
import { storeInvite } from '@/db/store.schema';
import { and, eq, gt } from 'drizzle-orm';

export function isPublicSignupEnabled(): boolean {
  return (
    process.env.PUBLIC_SIGNUP_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true'
  );
}

export function createInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function getValidStoreInvite(token: string | undefined) {
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(storeInvite)
    .where(
      and(
        eq(storeInvite.tokenHash, hashInviteToken(token)),
        eq(storeInvite.status, 'pending'),
        gt(storeInvite.expiresAt, new Date())
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

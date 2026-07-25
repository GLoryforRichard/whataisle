import 'server-only';

import { getDb } from '@/db';
import { impersonationGrant } from '@/db/store.schema';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Impersonation grants (requirements §7: "enter the store as the tenant …
 * fully audit-logged").
 *
 * Cross-tenant by design and admin-guarded only — deliberately outside the
 * storeId-bound repos in the same way platform-repo is.
 *
 * The signed hand-off token alone was not enough. It travels in a redirect
 * URL, so it lands in browser history, referrer headers and proxy logs, and
 * anything that scraped it could replay it for the rest of its 60-second life.
 * Recording the grant lets `consume` enforce genuine single use, and gives the
 * resulting session an id that can be revoked on its own.
 */
export function impersonationRepo() {
  return {
    /** Record a freshly minted hand-off token. Stores only its hash. */
    async create(input: {
      tokenHash: string;
      storeId: string;
      actorUserId: string;
      expiresAt: Date;
    }): Promise<string> {
      const db = await getDb();
      const id = nanoid();
      await db.insert(impersonationGrant).values({ id, ...input });
      return id;
    },

    /**
     * Atomically claim a grant. Returns its id, or null when the token is
     * unknown, already used, expired, or for a different store.
     *
     * The guard clauses live in the UPDATE's WHERE rather than in a preceding
     * SELECT so two simultaneous replays cannot both pass the check.
     */
    async consume(input: {
      tokenHash: string;
      storeId: string;
    }): Promise<string | null> {
      const db = await getDb();
      const now = new Date();
      const claimed = await db
        .update(impersonationGrant)
        .set({ consumedAt: now })
        .where(
          and(
            eq(impersonationGrant.tokenHash, input.tokenHash),
            eq(impersonationGrant.storeId, input.storeId),
            isNull(impersonationGrant.consumedAt)
          )
        )
        .returning({
          id: impersonationGrant.id,
          expiresAt: impersonationGrant.expiresAt,
        });
      const row = claimed[0];
      if (!row) return null;
      // Expiry is checked after claiming so an expired token is still burned
      // rather than left available for a later retry.
      if (row.expiresAt.getTime() < now.getTime()) return null;
      return row.id;
    },

    /**
     * Is this grant still valid for an active session? Revoking a grant row
     * (delete it, or set expiresAt into the past) kills exactly that
     * impersonation session, leaving the store's real staff signed in.
     */
    async isActive(grantId: string): Promise<boolean> {
      const db = await getDb();
      const rows = await db
        .select({ id: impersonationGrant.id })
        .from(impersonationGrant)
        .where(eq(impersonationGrant.id, grantId))
        .limit(1);
      return rows.length > 0;
    },

    /**
     * Drop grants older than a day. Safe to call opportunistically.
     *
     * A grant is a 60-second object; a day-old row is dead whatever its state,
     * so there is nothing to distinguish between consumed and expired here.
     * Note this also ends any impersonation session still riding that grant —
     * which is correct, since the cookie itself only lives an hour.
     */
    async prune(): Promise<void> {
      const db = await getDb();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db
        .delete(impersonationGrant)
        .where(lt(impersonationGrant.createdAt, cutoff));
    },
  };
}

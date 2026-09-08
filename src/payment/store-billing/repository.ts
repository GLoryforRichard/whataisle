import 'server-only';

import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import { storeRuntime } from '@/db/runtime.schema';
import { store } from '@/db/store.schema';
import {
  storeBillingEvent,
  storeBillingNotice,
  storeCheckout,
  storeSubscription,
} from '@/db/subscription.schema';
import { and, eq, inArray, isNotNull, isNull, not, sql } from 'drizzle-orm';
import registry from '../../../stores/registry.json';
import { PaymentScenes, PaymentTypes, PlanIntervals } from '../types';
import type { BillingRepository, BillingTransaction } from './contracts';
import type { BillingCheckout, OwnerBilling } from './model';

/** Shared with the atomic store/setup transaction. Keep this value stable. */
export const BILLING_ADVISORY_LOCK = 619914199;

function legacySubscriptionPredicate(ownerId: string) {
  return and(
    eq(payment.userId, ownerId),
    eq(payment.type, PaymentTypes.SUBSCRIPTION),
    isNotNull(payment.subscriptionId),
    inArray(payment.status, ['active', 'trialing', 'past_due', 'unpaid']),
    not(
      sql`coalesce(${payment.cancelAtPeriodEnd}, false) and ${payment.periodEnd} is not null and ${payment.periodEnd} <= now()`
    )
  );
}

// Queue same-process writers before borrowing a DB connection. Otherwise a
// slow Stripe operation plus ten waiting advisory-lock transactions can fill
// the shared connection pool and indirectly block even ordinary SELECTs.
// The PostgreSQL lock remains necessary for other workers/processes and the
// atomic setup transaction; this queue does not replace that lock.
let writeQueue = Promise.resolve();

async function serializeWriter<T>(run: () => Promise<T>): Promise<T> {
  const previous = writeQueue;
  let release!: () => void;
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

export const billingRepository: BillingRepository = {
  async hasLegacySubscription(ownerId) {
    const db = await getDb();
    const [row] = await db
      .select({ id: payment.id })
      .from(payment)
      .where(legacySubscriptionPredicate(ownerId))
      .limit(1);
    return !!row;
  },
  async getBilling(ownerId) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.ownerUserId, ownerId))
      .limit(1);
    return (row as OwnerBilling | undefined) ?? null;
  },
  async getBillingByStore(storeId) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.storeId, storeId))
      .limit(1);
    return (row as OwnerBilling | undefined) ?? null;
  },
  async transaction(run) {
    return serializeWriter(async () => {
      const db = await getDb();
      return db.transaction(async (database) => {
        await database.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        const tx: BillingTransaction = {
          async getCapacitySnapshot() {
            return {
              registryHandles: registry.map((entry) => entry.handle),
              stores: await database
                .select({
                  id: store.id,
                  handle: store.handle,
                  ownerUserId: store.ownerUserId,
                  status: store.status,
                  runtimeStatus: storeRuntime.status,
                })
                .from(store)
                .leftJoin(storeRuntime, eq(storeRuntime.storeId, store.id)),
            };
          },
          async getBilling(ownerId) {
            const [row] = await database
              .select()
              .from(storeSubscription)
              .where(eq(storeSubscription.ownerUserId, ownerId))
              .limit(1);
            return (row as OwnerBilling | undefined) ?? null;
          },
          async getBillingByStore(storeId) {
            const [row] = await database
              .select()
              .from(storeSubscription)
              .where(eq(storeSubscription.storeId, storeId))
              .limit(1);
            return (row as OwnerBilling | undefined) ?? null;
          },
          async getAllBillings() {
            return (await database
              .select()
              .from(storeSubscription)) as OwnerBilling[];
          },
          async saveBilling(billing) {
            await database
              .insert(storeSubscription)
              .values(billing)
              .onConflictDoUpdate({
                target: storeSubscription.ownerUserId,
                set: billing,
              });
          },
          async getCheckout(id) {
            const [row] = await database
              .select()
              .from(storeCheckout)
              .where(eq(storeCheckout.id, id))
              .limit(1);
            return (row as BillingCheckout | undefined) ?? null;
          },
          async getCheckouts() {
            return (await database
              .select()
              .from(storeCheckout)) as BillingCheckout[];
          },
          async saveCheckout(checkout) {
            await database
              .insert(storeCheckout)
              .values(checkout)
              .onConflictDoUpdate({ target: storeCheckout.id, set: checkout });
          },
          async hasEvent(id) {
            const [row] = await database
              .select({ id: storeBillingEvent.id })
              .from(storeBillingEvent)
              .where(eq(storeBillingEvent.id, id))
              .limit(1);
            return !!row;
          },
          async saveEvent(id) {
            await database
              .insert(storeBillingEvent)
              .values({ id })
              .onConflictDoNothing();
          },
          async savePayment(billing, invoice, sessionId) {
            // Compatibility record is keyed by invoice, so callback polling and
            // old owner billing views observe exactly one successful payment.
            const record = {
              id: `store:${invoice.id}`,
              priceId: invoice.priceId,
              type: PaymentTypes.SUBSCRIPTION,
              scene: PaymentScenes.SUBSCRIPTION,
              interval:
                billing.plan === 'month'
                  ? PlanIntervals.MONTH
                  : PlanIntervals.YEAR,
              userId: billing.ownerUserId,
              customerId: invoice.customerId,
              subscriptionId: invoice.subscriptionId,
              sessionId,
              invoiceId: invoice.id,
              status: 'active' as const,
              paid: true,
              periodStart: billing.periodStart,
              periodEnd: billing.entitlementEnd,
              cancelAtPeriodEnd: billing.cancelAtEnd,
              updatedAt: new Date(),
            };
            await database
              .insert(payment)
              .values(record)
              .onConflictDoUpdate({ target: payment.invoiceId, set: record });
            await database
              .update(user)
              .set({ customerId: invoice.customerId, updatedAt: new Date() })
              .where(eq(user.id, billing.ownerUserId));
          },
          async enqueueNotice(notice) {
            await database
              .insert(storeBillingNotice)
              .values(notice)
              .onConflictDoNothing();
          },
          async getNotices() {
            return database
              .select()
              .from(storeBillingNotice)
              .where(isNull(storeBillingNotice.sentAt));
          },
          async markNoticeSent(id, at) {
            await database
              .update(storeBillingNotice)
              .set({ sentAt: at })
              .where(eq(storeBillingNotice.id, id));
          },
          async getOwner(id) {
            const [row] = await database
              .select({ id: user.id, email: user.email, name: user.name })
              .from(user)
              .where(eq(user.id, id))
              .limit(1);
            return row ?? null;
          },
          async hasLegacySubscription(ownerId) {
            const [row] = await database
              .select({ id: payment.id })
              .from(payment)
              .where(legacySubscriptionPredicate(ownerId))
              .limit(1);
            return !!row;
          },
          async isStorePermanentlyClosed(storeId) {
            const [row] = await database
              .select({ status: store.status })
              .from(store)
              .where(eq(store.id, storeId))
              .limit(1);
            return !row || row.status === 'closed' || row.status === 'closing';
          },
        };
        return run(tx);
      });
    });
  },
};

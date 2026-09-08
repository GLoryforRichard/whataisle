/** Opt-in local PostgreSQL capacity acceptance; no Stripe or mail operations.
 * STORE_BILLING_POSTGRES_TEST=1 node --env-file=.env --import tsx --test
 * tests/unit/store-billing-postgres-capacity.test.ts */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  type BillingGateway,
  type BillingRepository,
  CheckoutNotCreatedError,
  type CheckoutSession,
} from '../../src/payment/store-billing/contracts';
import {
  type BillingCheckout,
  type BillingOwner,
  pendingBilling,
} from '../../src/payment/store-billing/model';
import { StoreBillingService } from '../../src/payment/store-billing/service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  'PostgreSQL: locked capacity snapshots prevent overselling across concurrent checkout and setup writers',
  { skip: process.env.STORE_BILLING_POSTGRES_TEST !== '1', timeout: 20000 },
  async () => {
    const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
    assert.equal(target.port, '5433');
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(
          specifier === 'server-only'
            ? 'next/dist/compiled/server-only/empty.js'
            : specifier,
          context
        );
      },
    });
    const require = createRequire(import.meta.url);
    const { getDb } = require('../../src/db') as typeof import('../../src/db');
    const { user } =
      require('../../src/db/auth.schema') as typeof import('../../src/db/auth.schema');
    const { store } =
      require('../../src/db/store.schema') as typeof import('../../src/db/store.schema');
    const { storeRuntime } =
      require('../../src/db/runtime.schema') as typeof import('../../src/db/runtime.schema');
    const { storeSubscription, storeCheckout } =
      require('../../src/db/subscription.schema') as typeof import('../../src/db/subscription.schema');
    const { billingRepository, BILLING_ADVISORY_LOCK } =
      require('../../src/payment/store-billing/repository') as typeof import('../../src/payment/store-billing/repository');
    const db = await getDb();
    const prefix = `capacity-${randomUUID()}`;
    const names = [
      'legacy',
      'retained',
      'archived',
      'paid',
      'external',
      'second',
      'rejected',
      'ambiguous',
      'last',
      ...Array.from({ length: 8 }, (_, i) => `new-${i}`),
    ];
    const owners = names.map((name) => ({
      id: `${prefix}-${name}`,
      name,
      email: `${prefix}-${name}@example.test`,
    }));
    const ownerIds = owners.map((owner) => owner.id);
    const owner = (name: string) =>
      owners.find((entry) => entry.name === name)!;
    const storeId = (name: string) => `${prefix}-store-${name}`;
    const storeIds = ['legacy', 'retained', 'archived', 'paid'].map(storeId);
    const own = (id: string) => ownerIds.includes(id);
    const repo: BillingRepository = {
      ...billingRepository,
      transaction: (run) =>
        billingRepository.transaction((tx) =>
          run({
            ...tx,
            // Read real joined database rows, but isolate this acceptance test from
            // unrelated development fixtures and ongoing E2E runs on the same DB.
            getCapacitySnapshot: async () => ({
              registryHandles: ['wherebear', `${prefix}-legacy`],
              stores: (await tx.getCapacitySnapshot()).stores.filter((row) =>
                own(row.ownerUserId)
              ),
            }),
            getAllBillings: async () =>
              (await tx.getAllBillings()).filter((row) => own(row.ownerUserId)),
            getCheckouts: async () =>
              (await tx.getCheckouts()).filter((row) => own(row.ownerUserId)),
          })
        ),
    };
    const sessions = new Map<string, CheckoutSession>();
    let fail: 'definitive' | 'ambiguous' | null = null;
    const gateway = {
      createCheckout: async (
        _owner: BillingOwner,
        attempt: BillingCheckout
      ) => {
        if (fail === 'definitive') {
          fail = null;
          throw new CheckoutNotCreatedError('definitive rejection');
        }
        if (!sessions.has(attempt.id))
          sessions.set(attempt.id, {
            id: attempt.id,
            url: 'https://checkout.example.test',
            status: 'open',
            subscriptionId: null,
            invoice: null,
          });
        if (fail === 'ambiguous') {
          fail = null;
          throw new Error('response lost after remote creation');
        }
        return sessions.get(attempt.id)!;
      },
      getCheckout: async (id: string) => sessions.get(id)!,
    } as unknown as BillingGateway;
    const service = new StoreBillingService(repo, gateway, {
      STRIPE_PRICE_USD_MONTH: 'price_fixture',
    });
    const checkout = (name: string) =>
      service.createCheckout(owner(name), {
        requestId: owner(name).id,
        plan: 'month',
      });
    const paid = (name: string) => ({
      ...pendingBilling(
        {
          currency: 'usd',
          plan: 'month',
          amount: 19900,
          priceId: 'price_fixture',
          isTest: false,
        },
        owner(name).id,
        new Date()
      ),
      status: 'suspended' as const,
      lastPaidAt: new Date(),
      cancelAtEnd: true,
    });
    const locked = deferred();
    const release = deferred();
    let external: Promise<unknown> | null = null;
    let waiting: Promise<unknown> | null = null;
    try {
      await db.insert(user).values(
        owners.map((entry) => ({
          ...entry,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      await db.insert(store).values([
        {
          id: storeId('legacy'),
          ownerUserId: owner('legacy').id,
          handle: `${prefix}-legacy`,
          displayName: 'Capacity legacy',
          status: 'live' as const,
        },
        {
          id: storeId('retained'),
          ownerUserId: owner('retained').id,
          handle: `${prefix}-retained`,
          displayName: 'Capacity retained',
          status: 'closing' as const,
        },
        {
          id: storeId('archived'),
          ownerUserId: owner('archived').id,
          handle: `${prefix}-archived`,
          displayName: 'Capacity archived',
          status: 'closed' as const,
        },
      ]);
      await db.insert(storeRuntime).values([
        {
          storeId: storeId('retained'),
          jobId: randomUUID(),
          kind: 'archive',
          status: 'failed',
        },
        {
          storeId: storeId('archived'),
          jobId: randomUUID(),
          kind: 'archive',
          status: 'archived',
        },
      ]);
      await db
        .insert(storeSubscription)
        .values([
          paid('paid'),
          { ...paid('archived'), storeId: storeId('archived') },
        ]);
      // Four occupied places: registry WhereBear + registry/DB legacy dedup +
      // failed cleanup + canceled paid-but-unbuilt owner. Archived is free.
      external = db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        await tx.insert(storeSubscription).values(paid('external'));
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      waiting = assert.rejects(checkout('second'), /All five store places/);
      await new Promise((done) => setTimeout(done, 80));
      assert.equal(sessions.size, 0);
      release.resolve();
      await Promise.all([external, waiting]);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        await tx
          .delete(storeSubscription)
          .where(eq(storeSubscription.ownerUserId, owner('external').id));
      });
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => checkout(`new-${i}`))
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1
      );
      assert.equal(sessions.size, 1);
      const winner = [...sessions.keys()][0]!;
      await checkout('legacy');
      assert.equal(
        sessions.size,
        2,
        'Existing owner reuses the physical store slot'
      );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        await tx
          .update(storeRuntime)
          .set({ status: 'archived' })
          .where(eq(storeRuntime.storeId, storeId('retained')));
      });
      await assert.rejects(checkout('second'), /All five store places/);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        await tx
          .update(store)
          .set({ status: 'closed' })
          .where(eq(store.id, storeId('retained')));
      });
      await checkout('second');
      // The setup transaction replaces the paid owner reservation with one
      // queued physical store, without charging for or reserving a second slot.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${BILLING_ADVISORY_LOCK})`
        );
        await tx.insert(store).values({
          id: storeId('paid'),
          ownerUserId: owner('paid').id,
          handle: `${prefix}-paid`,
          displayName: 'Capacity queued',
        });
        await tx
          .insert(storeRuntime)
          .values({ storeId: storeId('paid'), jobId: randomUUID() });
        await tx
          .update(storeSubscription)
          .set({ storeId: storeId('paid') })
          .where(eq(storeSubscription.ownerUserId, owner('paid').id));
      });
      await assert.rejects(checkout('last'), /All five store places/);
      sessions.get(winner)!.status = 'expired';
      fail = 'definitive';
      await assert.rejects(checkout('rejected'), /definitive rejection/);
      assert.equal(
        (
          await db
            .select()
            .from(storeCheckout)
            .where(eq(storeCheckout.id, owner('rejected').id))
        )[0]!.status,
        'expired'
      );
      fail = 'ambiguous';
      await assert.rejects(checkout('ambiguous'), /response lost/);
      await assert.rejects(checkout('last'), /All five store places/);
      sessions.get(owner('ambiguous').id)!.status = 'expired';
      await checkout('last');
      assert.equal(
        (
          await db
            .select()
            .from(storeCheckout)
            .where(eq(storeCheckout.id, owner('last').id))
        )[0]!.status,
        'open'
      );
    } finally {
      release.resolve();
      await Promise.allSettled([
        ...(external ? [external] : []),
        ...(waiting ? [waiting] : []),
      ]);
      await db
        .delete(storeCheckout)
        .where(inArray(storeCheckout.ownerUserId, ownerIds));
      await db
        .delete(storeSubscription)
        .where(inArray(storeSubscription.ownerUserId, ownerIds));
      await db
        .delete(storeRuntime)
        .where(inArray(storeRuntime.storeId, storeIds));
      await db.delete(store).where(inArray(store.id, storeIds));
      await db.delete(user).where(inArray(user.id, ownerIds));
      await (
        db as unknown as {
          $client: { end(options: { timeout: number }): Promise<void> };
        }
      ).$client.end({ timeout: 5 });
      hooks.deregister();
    }
  }
);

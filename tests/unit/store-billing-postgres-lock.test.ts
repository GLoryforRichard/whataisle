/** Opt-in integration regression, only against the existing local :5433 DB.
 * STORE_BILLING_POSTGRES_TEST=1 node --env-file=.env --import tsx --test
 * tests/unit/store-billing-postgres-lock.test.ts
 * All mutations are uniquely named test fixtures and are removed in finally. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { inArray } from 'drizzle-orm';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  'PostgreSQL: store/owner reads stay available during a locked billing mutation and queued writers',
  { skip: process.env.STORE_BILLING_POSTGRES_TEST !== '1', timeout: 15000 },
  async () => {
    const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
      'Refusing a nonlocal database target'
    );
    assert.equal(
      target.port,
      '5433',
      'Use only the existing dedicated local development database'
    );
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
    const { storeSubscription } =
      require('../../src/db/subscription.schema') as typeof import('../../src/db/subscription.schema');
    const { billingRepository } =
      require('../../src/payment/store-billing/repository') as typeof import('../../src/payment/store-billing/repository');
    const { getOwnerBilling, getStoreServiceAccess } =
      require('../../src/payment/store-billing') as typeof import('../../src/payment/store-billing');
    const db = await getDb();
    const marker = `billing-lock-${randomUUID()}`;
    const owners = [`${marker}-a`, `${marker}-b`];
    const stores = [`${marker}-store-a`, `${marker}-store-b`];
    const locked = deferred();
    const releaseWriter = deferred();
    let writer: Promise<void> | null = null;
    let queued: Promise<unknown>[] = [];
    let reading: Promise<unknown> | null = null;
    try {
      await db.insert(user).values(
        owners.map((id) => ({
          id,
          name: 'Billing lock fixture',
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      await db.insert(storeSubscription).values(
        owners.map((ownerUserId, index) => ({
          ownerUserId,
          storeId: stores[index]!,
          currency: 'usd',
          plan: 'month',
          status: 'active',
          entitlementEnd: new Date(Date.now() + 86400000),
          periodStart: new Date(),
        }))
      );
      writer = billingRepository
        .transaction(async (tx) => {
          const billing = (await tx.getBilling(owners[0]!))!;
          billing.status = 'suspended';
          await tx.saveBilling(billing);
          locked.resolve();
          await releaseWriter.promise;
          throw new Error('EXPECTED_ROLLBACK_AFTER_REMOTE_FAILURE');
        })
        .then(
          () => assert.fail('Writer must roll back'),
          (error: unknown) => {
            assert.ok(
              error instanceof Error &&
                error.message === 'EXPECTED_ROLLBACK_AFTER_REMOTE_FAILURE'
            );
          }
        );
      await locked.promise;
      // More waiters than the default postgres.js pool capacity proves the local
      // writer queue does not consume every connection while waiting on Stripe.
      queued = Array.from({ length: 14 }, () =>
        billingRepository.transaction(async (tx) => {
          assert.ok(await tx.getBilling(owners[1]!));
        })
      );
      const startedAt = performance.now();
      reading = Promise.all([
        getOwnerBilling(owners[0]!),
        getOwnerBilling(owners[1]!),
        getStoreServiceAccess(stores[0]!),
        getStoreServiceAccess(stores[1]!),
        getStoreServiceAccess('no-such-store'),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reading,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Public billing reads waited behind the commercial mutation lock'
                )
              ),
            2000
          );
        }),
      ]).finally(() => clearTimeout(timer));
      const rows = result as [
        Awaited<ReturnType<typeof getOwnerBilling>>,
        Awaited<ReturnType<typeof getOwnerBilling>>,
        Awaited<ReturnType<typeof getStoreServiceAccess>>,
        Awaited<ReturnType<typeof getStoreServiceAccess>>,
        Awaited<ReturnType<typeof getStoreServiceAccess>>,
      ];
      assert.equal(
        rows[0]!.status,
        'active',
        'Read the last committed state, not the in-flight Stripe mutation'
      );
      assert.equal(rows[1]!.ownerUserId, owners[1]);
      assert.equal(rows[2].accessAllowed, true);
      assert.equal(rows[3].accessAllowed, true);
      assert.equal(rows[4].accessAllowed, false);
      assert.ok(performance.now() - startedAt < 2000);
      releaseWriter.resolve();
      await writer;
      await Promise.all(queued);
      assert.equal(
        (await getOwnerBilling(owners[0]!))!.status,
        'active',
        'Failed mutation did not commit its entitlement change'
      );
    } finally {
      releaseWriter.resolve();
      await Promise.allSettled([
        ...(writer ? [writer] : []),
        ...queued,
        ...(reading ? [reading] : []),
      ]);
      await db
        .delete(storeSubscription)
        .where(inArray(storeSubscription.ownerUserId, owners));
      await db.delete(user).where(inArray(user.id, owners));
      await (
        db as unknown as {
          $client: { end(options: { timeout: number }): Promise<void> };
        }
      ).$client.end({ timeout: 5 });
      hooks.deregister();
    }
  }
);

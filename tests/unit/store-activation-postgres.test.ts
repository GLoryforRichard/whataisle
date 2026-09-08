/** Real local PostgreSQL and route acceptance, without a server/provider call.
 * STORE_ACTIVATION_POSTGRES_TEST=1 node --import tsx --test <this file>
 * Set only the dedicated local DATABASE_URL (loopback:5433). */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';

test(
  'PostgreSQL: map-first activation, worker fencing and retained-store cleanup',
  {
    skip: process.env.STORE_ACTIVATION_POSTGRES_TEST !== '1',
    timeout: 30000,
  },
  async (t) => {
    const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
    assert.equal(target.port, '5433');
    assert.ok(!target.searchParams.has('host'));
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
    const { store, auditLog } =
      require('../../src/db/store.schema') as typeof import('../../src/db/store.schema');
    const { storeRuntime, storeOwnerEntry } =
      require('../../src/db/runtime.schema') as typeof import('../../src/db/runtime.schema');
    const { storeSubscription, storeCheckout } =
      require('../../src/db/subscription.schema') as typeof import('../../src/db/subscription.schema');
    const {
      activateStoreSearch,
      createOwnerMapEntry,
      consumeOwnerMapEntry,
      getOwnerStore,
      requestStoreCleanup,
      retryStoreProvisioning,
    } =
      require('../../src/data/owner-store') as typeof import('../../src/data/owner-store');
    const {
      claimStoreJob,
      registerRuntimeCredentials,
      finishStoreJob,
      failStoreJob,
    } =
      require('../../src/data/store-provisioning') as typeof import('../../src/data/store-provisioning');
    const { POST } =
      require('../../src/app/api/internal/provisioning/[operation]/route') as typeof import('../../src/app/api/internal/provisioning/[operation]/route');
    const { GET } =
      require('../../src/app/api/runtime/store/[storeId]/route') as typeof import('../../src/app/api/runtime/store/[storeId]/route');
    const { getStoreUrl } =
      require('../../src/lib/urls') as typeof import('../../src/lib/urls');
    const { hashStorePin, newSecret, secretDigest } =
      require('../../src/lib/store-secrets') as typeof import('../../src/lib/store-secrets');
    const db = await getDb();
    // Never claim another test or owner's queued work from this global queue.
    assert.equal(
      (
        await db
          .select({ id: storeRuntime.storeId })
          .from(storeRuntime)
          .where(
            inArray(storeRuntime.status, ['queued', 'retry', 'provisioning'])
          )
      ).length,
      0,
      'Local provisioning queue must be idle before running this test'
    );
    const suffix = randomUUID().slice(0, 8);
    const adminId = `activation-${suffix}-admin`;
    const fixtures = [0, 1, 2].map((i) => ({
      id: randomUUID(),
      ownerId: `activation-${suffix}-${i}`,
      handle: `act-${suffix}-${i}`,
      token: newSecret(),
      port: 61891 + i,
    }));
    const a = fixtures[0],
      b = fixtures[1];
    const queuedProvision = fixtures[2];
    const ownerIds = [adminId, ...fixtures.map((f) => f.ownerId)];
    const storeIds = fixtures.map((f) => f.id);
    const savedWorkerToken = process.env.PROVISIONING_WORKER_TOKEN;
    const workerToken = newSecret();
    process.env.PROVISIONING_WORKER_TOKEN = workerToken;
    const pinHash = await hashStorePin('123456');
    const paidAt = new Date(Date.now() - 86400_000);
    const runtime = async (id: string) =>
      (
        await db.select().from(storeRuntime).where(eq(storeRuntime.storeId, id))
      )[0];
    const config = async (f: typeof a) => {
      const response = await GET(
        new Request(`${getStoreUrl(f.handle)}/api/runtime`, {
          headers: { Authorization: `Bearer ${f.token}` },
        }),
        { params: Promise.resolve({ storeId: f.id }) }
      );
      return { response, body: await response.json() };
    };
    const post = (operation: string, body: unknown) =>
      POST(
        new Request('http://localhost/api/internal/provisioning', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${workerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ operation }) }
      );
    const claim = async (id: string) => {
      const job = await claimStoreJob('activation-local-fixture', 300);
      assert.equal(job?.storeId, id);
      return job!;
    };
    try {
      await db.insert(user).values(
        ownerIds.map((id) => ({
          id,
          name: 'Local activation fixture',
          email: `${id}@example.test`,
          role: id === adminId ? 'admin' : 'user',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      for (const f of fixtures) {
        await db.insert(store).values({
          id: f.id,
          ownerUserId: f.ownerId,
          handle: f.handle,
          displayName: 'Preserved map store',
          staffPinHash: pinHash,
          status: 'onboarding',
        });
        await db.insert(storeSubscription).values({
          ownerUserId: f.ownerId,
          storeId: f.id,
          currency: 'usd',
          plan: 'month',
          status: 'active',
          lastPaidAt: paidAt,
          giftUsedAt: paidAt,
          entitlementEnd: new Date(Date.now() + 86400_000),
        });
        await db.insert(storeRuntime).values({
          storeId: f.id,
          jobId: randomUUID(),
          nextAttemptAt:
            f === queuedProvision
              ? new Date(Date.now() + 86400_000)
              : new Date(f === a ? 0 : 1),
        });
      }
      await t.test(
        'founder authorization and completed map runtime are required',
        async () => {
          await assert.rejects(
            activateStoreSearch(a.ownerId, a.id),
            /Administrator/
          );
          await assert.rejects(
            activateStoreSearch(adminId, a.id),
            /working map/
          );
        }
      );
      for (const f of fixtures.slice(0, 2)) {
        const job = await claim(f.id);
        await registerRuntimeCredentials({
          ...job,
          runtimeTokenHash: secretDigest(f.token),
          port: f.port,
        });
        await finishStoreJob({
          ...job,
          runtimeTokenHash: secretDigest(f.token),
          port: f.port,
          runtimeVersion: 'map-build-v1',
          canonicalUrl: getStoreUrl(f.handle),
        });
      }
      const firstReady = await runtime(a.id);
      const beforeStore = (
        await db.select().from(store).where(eq(store.id, a.id))
      )[0];
      const ownerGrant = new URL(
        await createOwnerMapEntry(a.ownerId)
      ).searchParams.get('owner_token')!;
      await t.test(
        'provision completion opens map access but does not attest search readiness',
        async () => {
          const { body } = await config(a);
          assert.equal(body.accessAllowed, true);
          assert.equal(body.setupAllowed, true);
          assert.equal(body.searchReady, false);
          assert.ok((await getOwnerStore(a.ownerId))?.readyAt);
          await db
            .update(storeSubscription)
            .set({ status: 'pending' })
            .where(eq(storeSubscription.storeId, a.id));
          await assert.rejects(
            activateStoreSearch(adminId, a.id),
            /paid, open store/
          );
          await db
            .update(storeSubscription)
            .set({ status: 'active' })
            .where(eq(storeSubscription.storeId, a.id));
          await db
            .update(store)
            .set({ status: 'closing' })
            .where(eq(store.id, a.id));
          await assert.rejects(
            activateStoreSearch(adminId, a.id),
            /paid, open store/
          );
          await db
            .update(store)
            .set({ status: 'onboarding' })
            .where(eq(store.id, a.id));
        }
      );
      let activationId = '';
      await t.test(
        'simultaneous founder clicks create exactly one job and retain existing runtime identity',
        async () => {
          const results = await Promise.all([
            activateStoreSearch(adminId, a.id),
            activateStoreSearch(adminId, a.id),
          ]);
          assert.equal(results[0].jobId, results[1].jobId);
          activationId = results[0].jobId;
          assert.notEqual(activationId, firstReady.jobId);
          const row = await runtime(a.id);
          assert.equal(row.kind, 'activate');
          assert.equal(row.status, 'queued');
          for (const key of [
            'readyAt',
            'runtimeTokenHash',
            'runtimeVersion',
            'port',
          ] as const)
            assert.deepEqual(row[key], firstReady[key]);
          assert.equal(
            (
              await db
                .select()
                .from(auditLog)
                .where(
                  and(
                    eq(auditLog.storeId, a.id),
                    eq(auditLog.action, 'runtime.activation_requested')
                  )
                )
            ).length,
            1
          );
          const { body } = await config(a);
          assert.equal(body.accessAllowed, true);
          assert.equal(body.searchReady, false);
        }
      );
      let activation = await claim(a.id);
      const accepted = () => ({
        jobId: activation.jobId,
        leaseToken: activation.leaseToken,
        kind: 'activate' as const,
        port: a.port,
        runtimeTokenHash: secretDigest(a.token),
        canonicalUrl: getStoreUrl(a.handle),
      });
      await t.test(
        'activation cannot register new credentials or finish with wrong kind, lease, host, port or token',
        async () => {
          assert.equal((await post('credentials', accepted())).status, 409);
          for (const mismatch of [
            { jobId: firstReady.jobId },
            { leaseToken: newSecret() },
            { canonicalUrl: getStoreUrl(b.handle) },
            { port: b.port },
            { runtimeTokenHash: secretDigest(b.token) },
            { kind: 'provision', runtimeVersion: 'bad' },
          ])
            assert.equal(
              (await post('complete', { ...accepted(), ...mismatch })).status,
              409
            );
          const { body } = await config(a);
          assert.equal(body.accessAllowed, true);
          assert.equal(body.searchReady, false);
          assert.deepEqual(
            (await getOwnerStore(a.ownerId))?.readyAt,
            firstReady.readyAt
          );
        }
      );
      await t.test(
        'claim rechecks paused activation access and continues to the next provision job',
        async () => {
          await failStoreJob({
            ...activation,
            code: 'SEARCH_INDEX_NOT_READY',
            retryable: true,
          });
          await db
            .update(storeRuntime)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(storeRuntime.storeId, a.id));
          await db
            .update(storeRuntime)
            .set({ nextAttemptAt: new Date(1) })
            .where(eq(storeRuntime.storeId, queuedProvision.id));
          await db
            .update(storeSubscription)
            .set({ status: 'suspended', entitlementEnd: paidAt })
            .where(eq(storeSubscription.storeId, a.id));
          const next = await claim(queuedProvision.id);
          assert.equal(next.kind, 'provision');
          const paused = await runtime(a.id);
          assert.equal(paused.status, 'failed');
          assert.equal(paused.lastError, 'ACTIVATION_ACCESS_REQUIRED');
          assert.equal(paused.leaseTokenHash, null);
          await assert.rejects(
            retryStoreProvisioning(adminId, a.id),
            /active store/
          );
          await registerRuntimeCredentials({
            ...next,
            port: queuedProvision.port,
            runtimeTokenHash: secretDigest(queuedProvision.token),
          });
          await finishStoreJob({
            ...next,
            port: queuedProvision.port,
            runtimeTokenHash: secretDigest(queuedProvision.token),
            canonicalUrl: getStoreUrl(queuedProvision.handle),
            runtimeVersion: 'map-build-v1',
          });
          await db
            .update(storeSubscription)
            .set({
              status: 'active',
              entitlementEnd: new Date(Date.now() + 86400_000),
            })
            .where(eq(storeSubscription.storeId, a.id));
          await retryStoreProvisioning(adminId, a.id);
          activation = await claim(a.id);
          assert.equal(activation.jobId, activationId);
        }
      );
      await t.test(
        'activation failure keeps the map available; only founder retry reuses the failed job',
        async () => {
          await failStoreJob({
            ...activation,
            code: 'SEARCH_NOT_READY',
            retryable: true,
          });
          assert.equal((await runtime(a.id)).status, 'retry');
          assert.equal(await claimStoreJob('backoff-check', 300), null);
          await db
            .update(storeRuntime)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(storeRuntime.storeId, a.id));
          const oldLease = activation;
          activation = await claim(a.id);
          assert.equal(
            (
              await post('complete', {
                ...accepted(),
                leaseToken: oldLease.leaseToken,
              })
            ).status,
            409
          );
          await failStoreJob({
            ...activation,
            code: 'SEARCH_TIER_NOT_SUPPORTED',
            retryable: false,
          });
          assert.equal((await config(a)).body.accessAllowed, true);
          assert.equal((await config(a)).body.searchReady, false);
          await assert.rejects(activateStoreSearch(adminId, a.id), /Retry/);
          await assert.rejects(
            retryStoreProvisioning(a.ownerId, a.id),
            /Administrator/
          );
          await retryStoreProvisioning(adminId, a.id);
          assert.equal((await runtime(a.id)).jobId, activationId);
          activation = await claim(a.id);
        }
      );
      await t.test(
        'only valid activation completion opens search; map grant, PIN, ready date and runtime version survive',
        async () => {
          assert.equal(
            (
              await post('complete', {
                ...accepted(),
                runtimeVersion: 'must-not-replace-map-runtime',
              })
            ).status,
            200
          );
          const row = await runtime(a.id);
          for (const key of [
            'readyAt',
            'runtimeTokenHash',
            'runtimeVersion',
            'port',
          ] as const)
            assert.deepEqual(row[key], firstReady[key]);
          assert.equal((await config(a)).body.searchReady, true);
          assert.deepEqual(
            (await db.select().from(store).where(eq(store.id, a.id)))[0],
            beforeStore
          );
          assert.equal(
            await consumeOwnerMapEntry(
              a.id,
              ownerGrant,
              beforeStore.pinVersion
            ),
            true
          );
          assert.equal(
            (await activateStoreSearch(adminId, a.id)).jobId,
            activationId
          );
          assert.equal((await post('complete', accepted())).status, 409);
          await db
            .update(storeSubscription)
            .set({ status: 'suspended', entitlementEnd: paidAt })
            .where(eq(storeSubscription.storeId, a.id));
          assert.equal((await config(a)).body.searchReady, false);
          assert.equal((await config(a)).body.accessAllowed, false);
        }
      );
      await activateStoreSearch(adminId, b.id);
      const failedActivation = await claim(b.id);
      await db
        .update(storeSubscription)
        .set({
          status: 'suspended',
          entitlementEnd: paidAt,
          suspendedAt: paidAt,
          retentionUntil: paidAt,
        })
        .where(eq(storeSubscription.storeId, b.id));
      await t.test(
        'cleanup cannot compete with a live activation lease, or an unsettled recovery checkout',
        async () => {
          await assert.rejects(
            requestStoreCleanup(adminId, b.id, b.handle),
            /lease/
          );
          await failStoreJob({
            ...failedActivation,
            code: 'SEARCH_TIER_NOT_SUPPORTED',
            retryable: false,
          });
          await assert.rejects(
            retryStoreProvisioning(adminId, b.id),
            /active store/
          );
          await db.insert(storeCheckout).values({
            id: randomUUID(),
            ownerUserId: b.ownerId,
            plan: 'month',
            currency: 'usd',
            isTest: false,
            giftEligible: false,
            priceId: 'price_local_fixture',
            amount: 19900,
            status: 'reserved',
            createdAt: paidAt,
            expiresAt: paidAt,
          });
          await assert.rejects(
            requestStoreCleanup(adminId, b.id, b.handle),
            /payment is still pending/
          );
          await db
            .delete(storeCheckout)
            .where(eq(storeCheckout.ownerUserId, b.ownerId));
        }
      );
      await t.test(
        'retained activation failure can be archived; stale activation cannot acknowledge or reenable access',
        async () => {
          await assert.rejects(
            requestStoreCleanup(adminId, b.id, 'wrong-handle')
          );
          await requestStoreCleanup(adminId, b.id, b.handle);
          const row = await runtime(b.id);
          assert.equal(row.kind, 'archive');
          assert.notEqual(row.jobId, failedActivation.jobId);
          assert.equal(row.leaseTokenHash, null);
          assert.equal(row.leaseExpiresAt, null);
          assert.equal((await config(b)).body.accessAllowed, false);
          assert.equal((await config(b)).body.searchReady, false);
          await assert.rejects(activateStoreSearch(adminId, b.id));
          assert.equal(
            (
              await post('complete', {
                ...failedActivation,
                kind: 'activate',
                port: b.port,
                runtimeTokenHash: secretDigest(b.token),
                canonicalUrl: getStoreUrl(b.handle),
              })
            ).status,
            409
          );
          const archive = await claim(b.id);
          await finishStoreJob({ ...archive, kind: 'archive' });
          assert.equal((await config(b)).response.status, 401);
          assert.equal(
            (await db.select().from(store).where(eq(store.id, b.id)))[0].status,
            'closed'
          );
          assert.deepEqual(
            (
              await db
                .select()
                .from(storeSubscription)
                .where(eq(storeSubscription.storeId, b.id))
            )[0].giftUsedAt,
            paidAt
          );
        }
      );
    } finally {
      await db
        .delete(storeCheckout)
        .where(inArray(storeCheckout.ownerUserId, ownerIds));
      await db
        .delete(storeOwnerEntry)
        .where(inArray(storeOwnerEntry.storeId, storeIds));
      await db.delete(auditLog).where(inArray(auditLog.storeId, storeIds));
      await db
        .delete(storeRuntime)
        .where(inArray(storeRuntime.storeId, storeIds));
      await db
        .delete(storeSubscription)
        .where(inArray(storeSubscription.ownerUserId, ownerIds));
      await db.delete(store).where(inArray(store.id, storeIds));
      await db.delete(user).where(inArray(user.id, ownerIds));
      if (savedWorkerToken === undefined)
        delete process.env.PROVISIONING_WORKER_TOKEN;
      else process.env.PROVISIONING_WORKER_TOKEN = savedWorkerToken;
      await (
        db as unknown as {
          $client: { end(options: { timeout: number }): Promise<void> };
        }
      ).$client.end({ timeout: 5 });
      hooks.deregister();
    }
  }
);

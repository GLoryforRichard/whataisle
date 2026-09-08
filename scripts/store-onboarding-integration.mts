/** Local PostgreSQL integration acceptance. This creates only unique fixture
 * owners/stores, exercises real repositories, then removes exactly those rows.
 * Run: node --env-file=.env --conditions=react-server --import tsx
 *      scripts/store-onboarding-integration.mts
 * No Stripe/Atlas/AI/email call is made by this test. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
const require = createRequire(import.meta.url);
// Next maps server-only to its empty server marker in server builds. Reuse
// that exact installed marker when invoking server repositories in Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === 'server-only'
        ? 'next/dist/compiled/server-only/empty.js'
        : specifier,
      context
    );
  },
});
const { getDb } =
  require('../src/db/index') as typeof import('../src/db/index');
const { user } =
  require('../src/db/auth.schema') as typeof import('../src/db/auth.schema');
const { storeOwnerEntry, storeRuntime } =
  require('../src/db/runtime.schema') as typeof import('../src/db/runtime.schema');
const { auditLog, store } =
  require('../src/db/store.schema') as typeof import('../src/db/store.schema');
const { storeCheckout, storeSubscription } =
  require('../src/db/subscription.schema') as typeof import('../src/db/subscription.schema');
const {
  consumeOwnerMapEntry,
  createOwnerMapEntry,
  createOwnerStore,
  getOwnerStore,
  isStoreHandleAvailable,
  requestStoreCleanup,
  retryStoreProvisioning,
  updateOwnerStore,
} =
  require('../src/data/owner-store') as typeof import('../src/data/owner-store');
const {
  claimStoreJob,
  failStoreJob,
  finishStoreJob,
  registerRuntimeCredentials,
  renewStoreLease,
} =
  require('../src/data/store-provisioning') as typeof import('../src/data/store-provisioning');
const { authenticateStoreRuntime } =
  require('../src/data/runtime-access') as typeof import('../src/data/runtime-access');
const { newSecret, secretDigest } =
  require('../src/lib/store-secrets') as typeof import('../src/lib/store-secrets');
const { POST: consumeEntryRoute } =
  require('../src/app/api/runtime/store/[storeId]/owner-entry/route') as typeof import('../src/app/api/runtime/store/[storeId]/owner-entry/route');
const { GET: runtimeConfigRoute } =
  require('../src/app/api/runtime/store/[storeId]/route') as typeof import('../src/app/api/runtime/store/[storeId]/route');

const { getStoreUrl } =
  require('../src/lib/urls') as typeof import('../src/lib/urls');

const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
  'This test refuses any nonlocal PostgreSQL target'
);
assert.equal(
  target.port,
  '5433',
  'Use only the existing dedicated local development PostgreSQL on 5433'
);
const marker = `e2e-owner-${randomUUID()}`;
const ownerIds = [marker, `${marker}-b`, `${marker}-admin`];
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const handles = [`e2e-${suffix}`, `e2e-${suffix}-b`];
const db = await getDb();
const baseline = await db.select({ id: store.id }).from(store);
const failures: string[] = [];
let checks = 0;

async function check(name: string, run: () => Promise<void>) {
  checks++;
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    // Never print provider errors, records, connection strings or raw tokens.
    console.error(
      `FAIL ${name}: ${error instanceof assert.AssertionError ? error.message.slice(0, 180) : 'operation rejected unexpectedly'}`
    );
  }
}

const billing = (ownerUserId: string) => ({
  ownerUserId,
  currency: 'usd',
  plan: 'month',
  status: 'active',
  periodStart: new Date(),
  entitlementEnd: new Date(Date.now() + 120 * 86400_000),
  giftUsedAt: new Date(),
});
const runtimeRequest = (token: string, storeId: string, entryToken?: string) =>
  new Request(
    `https://www.whataisle.com/api/runtime/store/${storeId}${entryToken ? '/owner-entry' : ''}`,
    {
      method: entryToken ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(entryToken ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(entryToken ? { body: JSON.stringify({ token: entryToken }) } : {}),
    }
  );
const entryToken = async (ownerId: string) =>
  new URL(await createOwnerMapEntry(ownerId)).searchParams.get('owner_token')!;
const params = (storeId: string) => ({ params: Promise.resolve({ storeId }) });
let storeIds: string[] = [];

try {
  await db.insert(user).values(
    ownerIds.map((id, index) => ({
      id,
      name: 'Isolated onboarding integration fixture',
      email: `${id}@example.test`,
      emailVerified: true,
      role: index === 2 ? 'admin' : 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  await check('unpaid owner cannot create a store or runtime job', async () => {
    await assert.rejects(
      createOwnerStore(ownerIds[0], {
        displayName: 'Unpaid fixture',
        handle: handles[0],
        pin: '123456',
      }),
      /Complete payment/
    );
    assert.equal(await getOwnerStore(ownerIds[0]), null);
  });
  await db.insert(storeSubscription).values(ownerIds.slice(0, 2).map(billing));
  await check(
    'simultaneous paid setup creates exactly one permanent store',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          createOwnerStore(ownerIds[0], {
            displayName: 'Fixture A',
            handle: handles[0],
            pin: '123456',
          })
        )
      );
      assert.equal(new Set(results.map((row) => row.storeId)).size, 1);
      const rows = await db
        .select()
        .from(store)
        .where(eq(store.ownerUserId, ownerIds[0]));
      assert.equal(rows.length, 1);
      assert.match(
        rows[0].staffPinHash!,
        /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/
      );
      assert.notEqual(rows[0].staffPinHash, '123456');
      const tasks = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, rows[0].id));
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].status, 'queued');
    }
  );
  await check(
    'existing owner cannot change permanent handle and another owner cannot claim it',
    async () => {
      await assert.rejects(
        createOwnerStore(ownerIds[0], {
          displayName: 'Changed',
          handle: handles[1],
          pin: '123456',
        }),
        /permanent store address/
      );
      await assert.rejects(
        createOwnerStore(ownerIds[1], {
          displayName: 'Duplicate',
          handle: handles[0],
          pin: '123456',
        })
      );
      assert.equal(await isStoreHandleAvailable(handles[0]), false);
    }
  );
  await check(
    'reserved handles and malformed passwords are refused',
    async () => {
      for (const handle of [
        'wherebear',
        'www',
        'admin',
        'api',
        '../store',
        'BadCAPS',
      ])
        await assert.rejects(
          createOwnerStore(ownerIds[1], {
            displayName: 'Reserved',
            handle,
            pin: '123456',
          })
        );
      for (const pin of ['12345', '1234567', 'abcdef'])
        await assert.rejects(
          createOwnerStore(ownerIds[1], {
            displayName: 'Invalid PIN',
            handle: handles[1],
            pin,
          })
        );
      assert.equal(await getOwnerStore(ownerIds[1]), null);
    }
  );
  await createOwnerStore(ownerIds[1], {
    displayName: 'Fixture B',
    handle: handles[1],
    pin: '654321',
  });
  const fixtures = await db
    .select()
    .from(store)
    .where(inArray(store.ownerUserId, ownerIds));
  storeIds = fixtures.map((row) => row.id);
  const a = fixtures.find((row) => row.ownerUserId === ownerIds[0])!;
  const b = fixtures.find((row) => row.ownerUserId === ownerIds[1])!;
  assert.ok(a && b, 'Prerequisite fixture setup failed');
  const runtimeA = newSecret();
  const runtimeB = newSecret();
  await db
    .update(storeRuntime)
    .set({ runtimeTokenHash: secretDigest(runtimeA) })
    .where(eq(storeRuntime.storeId, a.id));
  await db
    .update(storeRuntime)
    .set({ runtimeTokenHash: secretDigest(runtimeB) })
    .where(eq(storeRuntime.storeId, b.id));
  await check(
    'runtime bearer cannot authenticate to another store or without credentials',
    async () => {
      assert.ok(
        await authenticateStoreRuntime(a.id, runtimeRequest(runtimeA, a.id))
      );
      assert.equal(
        await authenticateStoreRuntime(b.id, runtimeRequest(runtimeA, b.id)),
        null
      );
      assert.equal(
        await authenticateStoreRuntime(
          a.id,
          new Request('https://www.whataisle.com')
        ),
        null
      );
      assert.equal(
        (await runtimeConfigRoute(runtimeRequest(runtimeA, b.id), params(b.id)))
          .status,
        401
      );
      const response = await runtimeConfigRoute(
        runtimeRequest(runtimeA, a.id),
        params(a.id)
      );
      const body = await response.json();
      assert.equal(body.storeId, a.id);
      assert.equal(body.displayName, 'Fixture A');
      assert.equal(body.accessAllowed, true);
    }
  );
  await check(
    'owner map token is bound to one store and can only be used once under concurrent redemption',
    async () => {
      const token = await entryToken(ownerIds[0]);
      assert.equal(
        await consumeOwnerMapEntry(b.id, token, a.pinVersion),
        false
      );
      const outcomes = await Promise.all([
        consumeOwnerMapEntry(a.id, token, a.pinVersion),
        consumeOwnerMapEntry(a.id, token, a.pinVersion),
      ]);
      assert.deepEqual(outcomes.sort(), [false, true]);
    }
  );
  await check('expired owner map token cannot be redeemed', async () => {
    const token = await entryToken(ownerIds[0]);
    await db
      .update(storeOwnerEntry)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(storeOwnerEntry.tokenHash, secretDigest(token)));
    assert.equal(await consumeOwnerMapEntry(a.id, token, a.pinVersion), false);
  });
  await check(
    'password change advances version and revokes pending owner tokens at real route boundary',
    async () => {
      const staleToken = await entryToken(ownerIds[0]);
      await updateOwnerStore(ownerIds[0], {
        pin: '223344',
        displayName: 'Renamed fixture',
      });
      const [updated] = await db.select().from(store).where(eq(store.id, a.id));
      assert.equal(updated.pinVersion, a.pinVersion + 1);
      assert.notEqual(updated.staffPinHash, a.staffPinHash);
      assert.equal(updated.handle, handles[0]);
      assert.equal(updated.displayName, 'Renamed fixture');
      const stale = await consumeEntryRoute(
        runtimeRequest(runtimeA, a.id, staleToken),
        params(a.id)
      );
      assert.equal(stale.status, 403);
      const fresh = await consumeEntryRoute(
        runtimeRequest(runtimeA, a.id, await entryToken(ownerIds[0])),
        params(a.id)
      );
      assert.equal(fresh.status, 200);
    }
  );

  // Refuse to run global claim tests if any unrelated runtime could be claimed;
  // this guard preserves other agents' local E2E work and demo stores.
  const otherJobs = await db
    .select({ id: storeRuntime.storeId })
    .from(storeRuntime)
    .where(
      and(
        or(
          eq(storeRuntime.status, 'queued'),
          eq(storeRuntime.status, 'retry'),
          eq(storeRuntime.status, 'provisioning')
        ),
        sql`${storeRuntime.storeId} not in (${sql.join(
          storeIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
    );
  assert.equal(
    otherJobs.length,
    0,
    'Provisioning queue is busy with another local task; do not claim unrelated work'
  );
  await db
    .update(storeRuntime)
    .set({ nextAttemptAt: new Date(0) })
    .where(inArray(storeRuntime.storeId, storeIds));
  let leasedA: Awaited<ReturnType<typeof claimStoreJob>> = null;
  let leasedB: Awaited<ReturnType<typeof claimStoreJob>> = null;
  await check(
    'parallel worker claims are exclusive and store-specific',
    async () => {
      const claimed = await Promise.all([
        claimStoreJob('integration-worker-a', 300),
        claimStoreJob('integration-worker-b', 300),
      ]);
      assert.equal(new Set(claimed.map((item) => item?.storeId)).size, 2);
      assert.ok(
        claimed.every((item) => item && storeIds.includes(item.storeId))
      );
      leasedA = claimed.find((item) => item?.storeId === a.id)!;
      leasedB = claimed.find((item) => item?.storeId === b.id)!;
      const persisted = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, a.id));
      assert.notEqual(persisted[0].leaseTokenHash, leasedA.leaseToken);
      assert.equal(
        persisted[0].leaseTokenHash,
        secretDigest(leasedA.leaseToken)
      );
    }
  );
  assert.ok(leasedA && leasedB, 'Prerequisite leasing failed');
  await check(
    'only live matching lease may heartbeat/register credentials',
    async () => {
      await assert.rejects(
        renewStoreLease(leasedA!.jobId, leasedB!.leaseToken)
      );
      await assert.rejects(
        registerRuntimeCredentials({
          jobId: leasedA!.jobId,
          leaseToken: leasedB!.leaseToken,
          runtimeTokenHash: secretDigest(runtimeA),
          port: 61901,
        })
      );
      const result = await renewStoreLease(leasedA!.jobId, leasedA!.leaseToken);
      assert.ok(Date.parse(result.leaseExpiresAt) > Date.now());
      await registerRuntimeCredentials({
        jobId: leasedA!.jobId,
        leaseToken: leasedA!.leaseToken,
        runtimeTokenHash: secretDigest(runtimeA),
        port: 61901,
      });
    }
  );
  await check(
    'expired lease is reclaimed with new token and old worker cannot finish',
    async () => {
      const prior = leasedB!;
      await db
        .update(storeRuntime)
        .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(storeRuntime.storeId, b.id));
      await assert.rejects(renewStoreLease(prior.jobId, prior.leaseToken));
      leasedB = await claimStoreJob('integration-worker-reclaimed', 300);
      assert.equal(leasedB?.storeId, b.id);
      assert.notEqual(leasedB?.leaseToken, prior.leaseToken);
      await assert.rejects(
        failStoreJob({
          jobId: prior.jobId,
          leaseToken: prior.leaseToken,
          code: 'stale_worker',
          retryable: true,
        })
      );
    }
  );
  await check(
    'ready acknowledgment must match host, registered token, port and job kind',
    async () => {
      const accepted = {
        jobId: leasedA!.jobId,
        leaseToken: leasedA!.leaseToken,
        runtimeTokenHash: secretDigest(runtimeA),
        port: 61901,
        runtimeVersion: 'integration-fixture',
        canonicalUrl: getStoreUrl(a.handle),
      };
      for (const mismatch of [
        { canonicalUrl: 'https://wrong.whataisle.com' },
        { port: 61902 },
        { runtimeTokenHash: secretDigest(runtimeB) },
        { kind: 'archive' as const },
      ])
        await assert.rejects(finishStoreJob({ ...accepted, ...mismatch }));
      await finishStoreJob(accepted);
      await assert.rejects(finishStoreJob(accepted));
      assert.equal(
        (
          await db
            .select()
            .from(storeRuntime)
            .where(eq(storeRuntime.storeId, a.id))
        )[0].status,
        'ready'
      );
    }
  );
  await check(
    'retryable worker failure releases lease and respects next-attempt backoff',
    async () => {
      await failStoreJob({
        jobId: leasedB!.jobId,
        leaseToken: leasedB!.leaseToken,
        code: 'ATLAS_TEMPORARY_FAILURE',
        retryable: true,
      });
      const [row] = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, b.id));
      assert.equal(row.status, 'retry');
      assert.equal(row.leaseTokenHash, null);
      assert.ok(row.nextAttemptAt > new Date());
      assert.equal(
        await claimStoreJob('integration-worker-backoff', 300),
        null
      );
    }
  );
  await check(
    'failed provisioning cannot be retried by its owner or an unrelated non-admin',
    async () => {
      await db
        .update(storeRuntime)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(storeRuntime.storeId, b.id));
      leasedB = await claimStoreJob('integration-permanent-failure', 300);
      assert.equal(leasedB?.storeId, b.id);
      await registerRuntimeCredentials({
        jobId: leasedB!.jobId,
        leaseToken: leasedB!.leaseToken,
        runtimeTokenHash: secretDigest(runtimeB),
        port: 61902,
      });
      await failStoreJob({
        jobId: leasedB!.jobId,
        leaseToken: leasedB!.leaseToken,
        code: 'ATLAS_PERMISSION_DENIED',
        retryable: false,
      });
      for (const actor of ownerIds.slice(0, 2))
        await assert.rejects(
          retryStoreProvisioning(actor, b.id),
          /Administrator required/
        );
      const [row] = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, b.id));
      assert.equal(row.status, 'failed');
    }
  );
  await check(
    'admin retry preserves job identity and runtime credentials, and records its actor',
    async () => {
      const [before] = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, b.id));
      await retryStoreProvisioning(ownerIds[2], b.id);
      const [after] = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, b.id));
      assert.equal(after.status, 'queued');
      assert.equal(after.lastError, null);
      for (const key of [
        'jobId',
        'storeId',
        'kind',
        'runtimeTokenHash',
        'port',
        'attempts',
      ] as const)
        assert.equal(after[key], before[key], `Retry changed ${key}`);
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.storeId, b.id),
            eq(auditLog.action, 'runtime.retry_requested')
          )
        );
      assert.equal(audit.actorUserId, ownerIds[2]);
      await assert.rejects(retryStoreProvisioning(ownerIds[2], b.id));
      await assert.rejects(retryStoreProvisioning(ownerIds[2], a.id));
      const retried = await claimStoreJob('integration-admin-retry', 300);
      assert.equal(retried?.jobId, before.jobId);
      assert.equal(retried?.storeId, b.id);
      // Keep this fixture outside the later archive claim's candidate set.
      await failStoreJob({
        jobId: retried!.jobId,
        leaseToken: retried!.leaseToken,
        code: 'FIXTURE_PAUSED_AFTER_RETRY',
        retryable: false,
      });
    }
  );
  await check(
    'cleanup cannot run while active, before retention expiry, or with wrong typed handle',
    async () => {
      await assert.rejects(requestStoreCleanup(ownerIds[2], a.id, a.handle));
      await db
        .update(storeSubscription)
        .set({
          status: 'suspended',
          suspendedAt: new Date(),
          retentionUntil: new Date(Date.now() + 86400_000),
        })
        .where(eq(storeSubscription.storeId, a.id));
      await assert.rejects(requestStoreCleanup(ownerIds[2], a.id, a.handle));
      await db
        .update(storeSubscription)
        .set({ retentionUntil: new Date(Date.now() - 1000) })
        .where(eq(storeSubscription.storeId, a.id));
      await assert.rejects(
        requestStoreCleanup(ownerIds[2], a.id, 'wrong-handle')
      );
    }
  );
  await check('cleanup repository also refuses a non-admin actor', async () => {
    await assert.rejects(requestStoreCleanup(ownerIds[0], a.id, a.handle));
  });
  await check(
    'cleanup waits for Stripe-confirmed recovery checkout settlement even after local expiry',
    async () => {
      const checkoutId = `${marker}-recovery`;
      await db.insert(storeCheckout).values({
        id: checkoutId,
        ownerUserId: ownerIds[0],
        plan: 'month',
        currency: 'usd',
        isTest: false,
        giftEligible: false,
        priceId: 'price_local_recovery_fixture',
        amount: 19900,
        status: 'reserved',
        createdAt: new Date(Date.now() - 7200_000),
        expiresAt: new Date(Date.now() - 3600_000),
      });
      for (const status of ['reserved', 'open']) {
        await db
          .update(storeCheckout)
          .set({ status })
          .where(eq(storeCheckout.id, checkoutId));
        await assert.rejects(
          requestStoreCleanup(ownerIds[2], a.id, a.handle),
          /recovery payment is still pending/
        );
        const [runtime] = await db
          .select()
          .from(storeRuntime)
          .where(eq(storeRuntime.storeId, a.id));
        assert.equal(runtime.status, 'ready');
        assert.equal(runtime.cleanupRequestedAt, null);
      }
      // Simulate the reconciler's explicit Stripe-confirmed expiry. The later
      // valid admin cleanup must then succeed with this receipt still present.
      await db
        .update(storeCheckout)
        .set({ status: 'expired' })
        .where(eq(storeCheckout.id, checkoutId));
    }
  );
  // If a regression allowed the non-admin check, restore only this test store
  // to exercise the valid admin branch and still report that failed check.
  await db
    .update(storeRuntime)
    .set({
      kind: 'provision',
      status: 'ready',
      cleanupRequestedAt: null,
      cleanupRequestedBy: null,
    })
    .where(eq(storeRuntime.storeId, a.id));
  await db
    .update(store)
    .set({ status: 'onboarding' })
    .where(eq(store.id, a.id));
  await check(
    'confirmed admin cleanup disables runtime access and queues archive only once',
    async () => {
      await requestStoreCleanup(ownerIds[2], a.id, a.handle);
      const [runtime] = await db
        .select()
        .from(storeRuntime)
        .where(eq(storeRuntime.storeId, a.id));
      assert.equal(runtime.kind, 'archive');
      assert.equal(runtime.status, 'queued');
      assert.equal(runtime.cleanupRequestedBy, ownerIds[2]);
      await assert.rejects(requestStoreCleanup(ownerIds[2], a.id, a.handle));
      const response = await runtimeConfigRoute(
        runtimeRequest(runtimeA, a.id),
        params(a.id)
      );
      const body = await response.json();
      assert.equal(body.accessAllowed, false);
      assert.equal(body.setupAllowed, false);
      const beforeGift = (
        await db
          .select()
          .from(storeSubscription)
          .where(eq(storeSubscription.storeId, a.id))
      )[0].giftUsedAt;
      const cleanup = await claimStoreJob('integration-cleanup-worker', 300);
      assert.equal(cleanup?.storeId, a.id);
      assert.equal(cleanup?.kind, 'archive');
      await finishStoreJob({
        jobId: cleanup!.jobId,
        leaseToken: cleanup!.leaseToken,
        kind: 'archive',
      });
      assert.equal(
        await authenticateStoreRuntime(a.id, runtimeRequest(runtimeA, a.id)),
        null
      );
      assert.equal(
        (await db.select().from(store).where(eq(store.id, a.id)))[0].status,
        'closed'
      );
      assert.deepEqual(
        (
          await db
            .select()
            .from(storeSubscription)
            .where(eq(storeSubscription.storeId, a.id))
        )[0].giftUsedAt,
        beforeGift
      );
    }
  );
} finally {
  const ownStores = await db
    .select({ id: store.id })
    .from(store)
    .where(inArray(store.ownerUserId, ownerIds));
  const ids = ownStores.map((row) => row.id);
  if (ids.length) {
    await db
      .delete(storeOwnerEntry)
      .where(inArray(storeOwnerEntry.storeId, ids));
    await db.delete(storeRuntime).where(inArray(storeRuntime.storeId, ids));
    await db.delete(auditLog).where(inArray(auditLog.storeId, ids));
  }
  await db
    .delete(storeCheckout)
    .where(inArray(storeCheckout.ownerUserId, ownerIds));
  await db
    .delete(storeSubscription)
    .where(inArray(storeSubscription.ownerUserId, ownerIds));
  await db.delete(store).where(inArray(store.ownerUserId, ownerIds));
  await db.delete(user).where(inArray(user.id, ownerIds));
  const remaining = await db.select({ id: store.id }).from(store);
  assert.ok(
    baseline.every((row) => remaining.some((current) => current.id === row.id)),
    'A pre-existing store disappeared during the integration run'
  );
  console.log(
    `Fixture cleanup complete; ${baseline.length} pre-existing stores preserved.`
  );
  // Drizzle retains a pooled postgres.js client; release it explicitly so the
  // standalone script does not leave an idle process or connection behind.
  await (
    db as unknown as {
      $client: { end: (options: { timeout: number }) => Promise<void> };
    }
  ).$client.end({ timeout: 5 });
}
console.log(
  `Onboarding integration: ${checks - failures.length}/${checks} checks passed.`
);
if (failures.length) process.exitCode = 1;

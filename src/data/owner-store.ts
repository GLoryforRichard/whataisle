import 'server-only';

import {
  isReservedHandle,
  isValidHandleFormat,
} from '@/config/reserved-handles';
import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import { storeOwnerEntry, storeRuntime } from '@/db/runtime.schema';
import { auditLog, store } from '@/db/store.schema';
import { storeCheckout, storeSubscription } from '@/db/subscription.schema';
import { hashStorePin, newSecret, secretDigest } from '@/lib/store-secrets';
import { getStoreUrl } from '@/lib/urls';
import {
  billingAccess,
  type OwnerBilling,
} from '@/payment/store-billing/model';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import registry from '../../stores/registry.json';

export function validStoreHandle(handle: string) {
  return (
    isValidHandleFormat(handle) &&
    !isReservedHandle(handle) &&
    !registry.some((entry) => entry.handle === handle)
  );
}

export async function isStoreHandleAvailable(handle: string) {
  if (!validStoreHandle(handle)) return false;
  const db = await getDb();
  return !(
    await db
      .select({ id: store.id })
      .from(store)
      .where(eq(store.handle, handle))
      .limit(1)
  ).length;
}

export async function getOwnerStore(ownerUserId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: store.id,
      handle: store.handle,
      displayName: store.displayName,
      status: store.status,
      runtimeStatus: storeRuntime.status,
      runtimeKind: storeRuntime.kind,
      readyAt: storeRuntime.readyAt,
      cleanupRequestedAt: storeRuntime.cleanupRequestedAt,
    })
    .from(store)
    .leftJoin(storeRuntime, eq(storeRuntime.storeId, store.id))
    .where(eq(store.ownerUserId, ownerUserId));
  return row ? { ...row, url: getStoreUrl(row.handle) } : null;
}

export async function createOwnerStore(
  ownerUserId: string,
  input: {
    displayName: string;
    handle: string;
    pin: string;
  }
) {
  if (!validStoreHandle(input.handle))
    throw new Error('This store address is unavailable');
  const pinHash = await hashStorePin(input.pin);
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Share the billing lock so suspension, checkout and setup cannot race.
    await tx.execute(sql`select pg_advisory_xact_lock(619914199)`);
    const [existing] = await tx
      .select()
      .from(store)
      .where(eq(store.ownerUserId, ownerUserId));
    if (existing) {
      if (existing.handle !== input.handle)
        throw new Error('This account already has a permanent store address');
      return { storeId: existing.id, url: getStoreUrl(existing.handle) };
    }
    const [billing] = await tx
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.ownerUserId, ownerUserId));
    if (
      !billingAccess((billing as OwnerBilling) ?? null, new Date()).setupAllowed
    ) {
      throw new Error('Complete payment before creating your store');
    }
    const storeId = crypto.randomUUID();
    await tx.insert(store).values({
      id: storeId,
      ownerUserId,
      handle: input.handle,
      displayName: input.displayName,
      staffPinHash: pinHash,
      status: 'onboarding',
    });
    await tx
      .insert(storeRuntime)
      .values({ storeId, jobId: crypto.randomUUID() });
    await tx
      .update(storeSubscription)
      .set({ storeId, updatedAt: new Date() })
      .where(eq(storeSubscription.ownerUserId, ownerUserId));
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: ownerUserId,
      storeId,
      action: 'store.created',
      targetType: 'store',
      targetId: storeId,
    });
    return { storeId, url: getStoreUrl(input.handle) };
  });
}

export async function updateOwnerStore(
  ownerUserId: string,
  input: { displayName?: string; pin?: string }
) {
  const pinHash = input.pin ? await hashStorePin(input.pin) : undefined;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select()
      .from(store)
      .where(eq(store.ownerUserId, ownerUserId))
      .for('update');
    if (!tenant || tenant.status === 'closed')
      throw new Error('Store unavailable');
    await tx
      .update(store)
      .set({
        displayName: input.displayName,
        ...(pinHash
          ? { staffPinHash: pinHash, pinVersion: tenant.pinVersion + 1 }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(store.id, tenant.id));
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: ownerUserId,
      storeId: tenant.id,
      action: pinHash ? 'store.password_changed' : 'store.name_changed',
      targetType: 'store',
      targetId: tenant.id,
    });
  });
}

export async function createOwnerMapEntry(ownerUserId: string) {
  const db = await getDb();
  const [tenant] = await db
    .select()
    .from(store)
    .where(eq(store.ownerUserId, ownerUserId));
  const [billing] = await db
    .select()
    .from(storeSubscription)
    .where(eq(storeSubscription.ownerUserId, ownerUserId));
  if (
    !tenant ||
    tenant.status === 'closed' ||
    !billingAccess((billing as OwnerBilling) ?? null, new Date()).accessAllowed
  ) {
    throw new Error('An active store is required');
  }
  const token = newSecret();
  await db.insert(storeOwnerEntry).values({
    tokenHash: secretDigest(token),
    storeId: tenant.id,
    pinVersion: tenant.pinVersion,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return `${getStoreUrl(tenant.handle)}/setup?owner_token=${encodeURIComponent(token)}`;
}

/** A runtime can consume only its own owner's grant, once and before expiry. */
export async function consumeOwnerMapEntry(
  storeId: string,
  token: string,
  pinVersion: number
) {
  const db = await getDb();
  const rows = await db
    .update(storeOwnerEntry)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(storeOwnerEntry.storeId, storeId),
        eq(storeOwnerEntry.tokenHash, secretDigest(token)),
        eq(storeOwnerEntry.pinVersion, pinVersion),
        isNull(storeOwnerEntry.consumedAt),
        gt(storeOwnerEntry.expiresAt, new Date())
      )
    )
    .returning({ storeId: storeOwnerEntry.storeId });
  return rows.length === 1;
}

export async function listStoreCleanup() {
  const db = await getDb();
  const rows = await db
    .select({
      id: store.id,
      handle: store.handle,
      displayName: store.displayName,
      status: store.status,
      runtimeStatus: storeRuntime.status,
      runtimeKind: storeRuntime.kind,
      readyAt: storeRuntime.readyAt,
      retentionUntil: storeSubscription.retentionUntil,
      suspendedAt: storeSubscription.suspendedAt,
      cleanupRequestedAt: storeRuntime.cleanupRequestedAt,
      billing: storeSubscription,
    })
    .from(store)
    .innerJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
    .leftJoin(storeRuntime, eq(storeRuntime.storeId, store.id));
  return rows.map(({ billing, ...row }) => ({
    ...row,
    accessAllowed: billingAccess(billing as OwnerBilling, new Date())
      .accessAllowed,
  }));
}

/** Founder-approved Search activation is separate from opening the map URL.
 * The shared billing lock fences cleanup/payment races; the row lock fences
 * worker claims and duplicate clicks without changing the existing runtime. */
export async function activateStoreSearch(actorId: string, storeId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, actorId));
    if (actor?.role !== 'admin') throw new Error('Administrator required');
    await tx.execute(sql`select pg_advisory_xact_lock(619914199)`);
    const [tenant] = await tx
      .select()
      .from(store)
      .where(eq(store.id, storeId))
      .for('update');
    const [billing] = await tx
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.storeId, storeId));
    const [runtime] = await tx
      .select()
      .from(storeRuntime)
      .where(eq(storeRuntime.storeId, storeId))
      .for('update');
    if (
      !tenant ||
      ['closing', 'closed'].includes(tenant.status) ||
      !billingAccess((billing as OwnerBilling) ?? null, new Date())
        .accessAllowed ||
      !runtime?.readyAt ||
      runtime.cleanupRequestedAt ||
      !runtime.port ||
      !runtime.runtimeTokenHash
    )
      throw new Error('A paid, open store with a working map is required');
    if (runtime.kind === 'activate') {
      if (runtime.status === 'failed')
        throw new Error('Retry the failed activation job');
      return { jobId: runtime.jobId };
    }
    if (
      runtime.kind !== 'provision' ||
      runtime.status !== 'ready' ||
      (runtime.leaseExpiresAt && runtime.leaseExpiresAt > new Date())
    )
      throw new Error('Store setup must finish before activation');
    const jobId = crypto.randomUUID();
    await tx
      .update(storeRuntime)
      .set({
        kind: 'activate',
        status: 'queued',
        jobId,
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseTokenHash: null,
        leaseExpiresAt: null,
        workerId: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(storeRuntime.storeId, storeId));
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actorId,
      storeId,
      action: 'runtime.activation_requested',
      targetType: 'store',
      targetId: storeId,
    });
    return { jobId };
  });
}

export async function requestStoreCleanup(
  actorId: string,
  storeId: string,
  confirmation: string
) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, actorId));
    if (actor?.role !== 'admin') throw new Error('Administrator required');
    await tx.execute(sql`select pg_advisory_xact_lock(619914199)`);
    const [tenant] = await tx
      .select()
      .from(store)
      .where(eq(store.id, storeId))
      .for('update');
    const [billing] = await tx
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.storeId, storeId));
    if (
      !tenant ||
      confirmation !== tenant.handle ||
      !billing ||
      billing.status !== 'suspended' ||
      !billing.retentionUntil ||
      billing.retentionUntil > new Date()
    )
      throw new Error('Store is not eligible for cleanup');
    // A previously issued recovery Checkout can still charge even if its local
    // expiry has elapsed. The billing reconciler must confirm it expired (or
    // apply its payment) before destructive cleanup can be queued. Sharing the
    // billing lock makes this check atomic with checkout reservation/fulfillment.
    const [unsettledCheckout] = await tx
      .select({ id: storeCheckout.id })
      .from(storeCheckout)
      .where(
        and(
          eq(storeCheckout.ownerUserId, tenant.ownerUserId),
          inArray(storeCheckout.status, ['reserved', 'open'])
        )
      )
      .limit(1);
    if (unsettledCheckout)
      throw new Error(
        'A recovery payment is still pending. Wait for payment reconciliation before cleaning up this store / 恢复付款仍待确认，请等待付款结果后再清理店铺'
      );
    const [runtime] = await tx
      .select()
      .from(storeRuntime)
      .where(eq(storeRuntime.storeId, storeId))
      .for('update');
    if (
      !runtime?.readyAt ||
      runtime.kind === 'archive' ||
      runtime.cleanupRequestedAt ||
      (runtime.leaseExpiresAt && runtime.leaseExpiresAt > new Date())
    )
      throw new Error(
        'Cleanup is already queued or a store job still holds its lease'
      );
    const rows = await tx
      .update(storeRuntime)
      .set({
        kind: 'archive',
        status: 'queued',
        jobId: crypto.randomUUID(),
        attempts: 0,
        nextAttemptAt: new Date(),
        cleanupRequestedAt: new Date(),
        cleanupRequestedBy: actorId,
        leaseTokenHash: null,
        leaseExpiresAt: null,
        workerId: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(storeRuntime.storeId, storeId))
      .returning({ id: storeRuntime.storeId });
    if (!rows.length)
      throw new Error(
        'Cleanup is already queued or store runtime is unavailable'
      );
    await tx
      .update(store)
      .set({ status: 'closing', updatedAt: new Date() })
      .where(eq(store.id, storeId));
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actorId,
      storeId,
      action: 'store.cleanup_requested',
      targetType: 'store',
      targetId: storeId,
    });
  });
}

export async function retryStoreProvisioning(actorId: string, storeId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, actorId));
    if (actor?.role !== 'admin') throw new Error('Administrator required');
    await tx.execute(sql`select pg_advisory_xact_lock(619914199)`);
    const [runtime] = await tx
      .select()
      .from(storeRuntime)
      .where(eq(storeRuntime.storeId, storeId))
      .for('update');
    if (
      !runtime ||
      runtime.status !== 'failed' ||
      (runtime.leaseExpiresAt && runtime.leaseExpiresAt > new Date())
    )
      throw new Error(
        'Only a failed job without an active lease can be retried'
      );
    if (runtime.kind === 'activate') {
      const [tenant] = await tx
        .select()
        .from(store)
        .where(eq(store.id, storeId));
      const [billing] = await tx
        .select()
        .from(storeSubscription)
        .where(eq(storeSubscription.storeId, storeId));
      if (
        !runtime.readyAt ||
        runtime.cleanupRequestedAt ||
        !tenant ||
        ['closing', 'closed'].includes(tenant.status) ||
        !billingAccess((billing as OwnerBilling) ?? null, new Date())
          .accessAllowed
      )
        throw new Error('An active store is required to retry activation');
    }
    const rows = await tx
      .update(storeRuntime)
      .set({
        status: 'queued',
        nextAttemptAt: new Date(),
        lastError: null,
        leaseTokenHash: null,
        leaseExpiresAt: null,
        workerId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storeRuntime.storeId, storeId),
          eq(storeRuntime.status, 'failed')
        )
      )
      .returning({ id: storeRuntime.storeId });
    if (!rows.length) throw new Error('Only a failed job can be retried');
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actorId,
      storeId,
      action: 'runtime.retry_requested',
      targetType: 'store',
      targetId: storeId,
    });
  });
}

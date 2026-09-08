import 'server-only';

import { getDb } from '@/db';
import { storeRuntime } from '@/db/runtime.schema';
import { auditLog, store } from '@/db/store.schema';
import { newSecret, secretDigest } from '@/lib/store-secrets';
import { getStoreUrl } from '@/lib/urls';
import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm';

/** Only worker-guarded callers may use this cross-store provisioning queue. */
export async function claimStoreJob(workerId: string, leaseSeconds: number) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const now = new Date();
    const [job] = await tx
      .select()
      .from(storeRuntime)
      .where(
        or(
          and(
            or(
              eq(storeRuntime.status, 'queued'),
              eq(storeRuntime.status, 'retry')
            ),
            lte(storeRuntime.nextAttemptAt, now)
          ),
          and(
            eq(storeRuntime.status, 'provisioning'),
            lte(storeRuntime.leaseExpiresAt, now)
          )
        )
      )
      .orderBy(asc(storeRuntime.nextAttemptAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!job) return null;
    const [tenant] = await tx
      .select()
      .from(store)
      .where(eq(store.id, job.storeId));
    if (!tenant) throw new Error('Provisioning store is missing');
    const leaseToken = newSecret();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    await tx
      .update(storeRuntime)
      .set({
        status: 'provisioning',
        workerId,
        leaseTokenHash: secretDigest(leaseToken),
        leaseExpiresAt,
        attempts: sql`${storeRuntime.attempts} + 1`,
        updatedAt: now,
      })
      .where(eq(storeRuntime.storeId, job.storeId));
    return {
      jobId: job.jobId,
      kind: job.kind,
      storeId: job.storeId,
      handle: tenant.handle,
      displayName: tenant.displayName,
      leaseToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  });
}

const leasedJob = (jobId: string, leaseToken: string) =>
  and(
    eq(storeRuntime.jobId, jobId),
    eq(storeRuntime.status, 'provisioning'),
    eq(storeRuntime.leaseTokenHash, secretDigest(leaseToken)),
    gt(storeRuntime.leaseExpiresAt, new Date())
  );

export async function renewStoreLease(jobId: string, leaseToken: string) {
  const db = await getDb();
  const leaseExpiresAt = new Date(Date.now() + 300_000);
  const rows = await db
    .update(storeRuntime)
    .set({ leaseExpiresAt, updatedAt: new Date() })
    .where(leasedJob(jobId, leaseToken))
    .returning({ id: storeRuntime.storeId });
  if (!rows.length) throw new Error('Lease expired or no longer owned');
  return { leaseExpiresAt: leaseExpiresAt.toISOString() };
}

export async function registerRuntimeCredentials(input: {
  jobId: string;
  leaseToken: string;
  runtimeTokenHash: string;
  port: number;
}) {
  const db = await getDb();
  const rows = await db
    .update(storeRuntime)
    .set({
      runtimeTokenHash: input.runtimeTokenHash,
      port: input.port,
      updatedAt: new Date(),
    })
    .where(
      and(
        leasedJob(input.jobId, input.leaseToken),
        eq(storeRuntime.kind, 'provision')
      )
    )
    .returning({ id: storeRuntime.storeId });
  if (!rows.length) throw new Error('Lease expired or no longer owned');
}

export async function finishStoreJob(input: {
  jobId: string;
  leaseToken: string;
  kind?: 'provision' | 'archive';
  runtimeTokenHash?: string;
  port?: number;
  runtimeVersion?: string;
  canonicalUrl?: string;
}) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(storeRuntime)
      .where(leasedJob(input.jobId, input.leaseToken))
      .for('update');
    if (!job) throw new Error('Lease expired or no longer owned');
    if (job.kind !== (input.kind ?? 'provision'))
      throw new Error('Job kind mismatch');
    const now = new Date();
    if (job.kind === 'archive') {
      await tx
        .update(storeRuntime)
        .set({
          status: 'archived',
          runtimeTokenHash: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(storeRuntime.storeId, job.storeId));
      await tx
        .update(store)
        .set({
          status: 'closed',
          closedAt: now,
          staffPinHash: null,
          pinVersion: sql`${store.pinVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(store.id, job.storeId));
    } else {
      const [tenant] = await tx
        .select()
        .from(store)
        .where(eq(store.id, job.storeId));
      const expectedUrl = getStoreUrl(tenant.handle);
      if (
        input.canonicalUrl !== expectedUrl ||
        !input.runtimeTokenHash ||
        input.runtimeTokenHash !== job.runtimeTokenHash ||
        input.port !== job.port
      ) {
        throw new Error('Runtime identity or credentials did not match');
      }
      await tx
        .update(storeRuntime)
        .set({
          status: 'ready',
          readyAt: now,
          runtimeVersion: input.runtimeVersion,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(storeRuntime.storeId, job.storeId));
    }
    await tx.insert(auditLog).values({
      id: crypto.randomUUID(),
      storeId: job.storeId,
      action: `runtime.${job.kind}.complete`,
      targetType: 'store',
      targetId: job.storeId,
    });
    return { ok: true };
  });
}

export async function failStoreJob(input: {
  jobId: string;
  leaseToken: string;
  code: string;
  retryable: boolean;
}) {
  const db = await getDb();
  // Store a constrained error code, never raw provider errors which can contain keys.
  const rows = await db
    .update(storeRuntime)
    .set({
      status: input.retryable ? 'retry' : 'failed',
      lastError: input.code,
      nextAttemptAt: new Date(Date.now() + 60_000),
      leaseTokenHash: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(leasedJob(input.jobId, input.leaseToken))
    .returning({ id: storeRuntime.storeId });
  if (!rows.length) throw new Error('Lease expired or no longer owned');
}

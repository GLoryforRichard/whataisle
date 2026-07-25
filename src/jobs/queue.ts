import 'server-only';

import { getDb } from '@/db';
import { type JobType, backgroundJob } from '@/db/store.schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Durable job queue over the background_job table.
 *
 * Exists because some work outlives a request. The clearest case is re-embed:
 * a full pass over every product in every store runs inside a route capped at
 * 300s with no way to resume, so a large catalog could not be re-embedded at
 * all. Jobs turn that into resumable chunks that survive a timeout.
 *
 * Deliberately simple: Postgres is the queue. `FOR UPDATE SKIP LOCKED` gives
 * safe concurrent claiming without a broker, and at this scale a broker would
 * be a second thing to operate for no benefit.
 */

export interface JobRecord {
  id: string;
  storeId: string | null;
  type: JobType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * What a handler returns.
 *   done          finished
 *   reschedule    more work remains — requeue with this payload (a cursor).
 *                 Progress is committed, so a later timeout loses only the
 *                 current chunk.
 */
export type JobResult =
  | { status: 'done' }
  | { status: 'reschedule'; payload: unknown; delaySeconds?: number };

export type JobHandler = (job: JobRecord) => Promise<JobResult>;

const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

/**
 * Enqueue a job. The idempotency key is unique, so enqueuing the same logical
 * work twice is a no-op rather than a duplicate — which is what makes it safe
 * to call this from a retried webhook or a double-clicked button.
 */
export async function enqueueJob(input: {
  type: JobType;
  idempotencyKey: string;
  payload: unknown;
  storeId?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
}): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .insert(backgroundJob)
    .values({
      id: nanoid(),
      storeId: input.storeId ?? null,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payloadJson: input.payload,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: backgroundJob.idempotencyKey })
    .returning({ id: backgroundJob.id });
  return rows[0]?.id ?? null;
}

/**
 * Claim one runnable job.
 *
 * SKIP LOCKED means two workers racing on the same tick take different rows
 * instead of blocking on each other. The status flip to 'processing' happens
 * in the same statement, so a claimed job cannot be claimed twice.
 */
async function claimJob(workerId: string): Promise<JobRecord | null> {
  const db = await getDb();
  const rows = (await db.execute(sql`
    UPDATE background_job SET
      status = 'processing',
      locked_at = now(),
      locked_by = ${workerId},
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM background_job
       WHERE status = 'queued' AND run_after <= now()
       ORDER BY run_after
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    RETURNING id, store_id AS "storeId", type, payload_json AS payload,
              attempts, max_attempts AS "maxAttempts"
  `)) as unknown as JobRecord[];
  return rows[0] ?? null;
}

/** Exponential backoff, capped — 2s, 4s, 8s … 5min. */
function backoffSeconds(attempts: number): number {
  return Math.min(300, 2 ** attempts);
}

async function finish(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  await db
    .update(backgroundJob)
    .set({ ...patch, lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(eq(backgroundJob.id, id));
}

/**
 * Run up to `max` jobs. Returns a summary for the caller to log.
 *
 * Bounded rather than draining the queue: the tick runs inside a request, so
 * it must finish well inside the route budget. Leftover work is picked up by
 * the next tick.
 */
export async function runJobs(
  max = 5
): Promise<{ ran: number; done: number; failed: number; rescheduled: number }> {
  const workerId = nanoid(8);
  const summary = { ran: 0, done: 0, failed: 0, rescheduled: 0 };

  for (let i = 0; i < max; i++) {
    const job = await claimJob(workerId);
    if (!job) break;
    summary.ran++;

    const handler = handlers.get(job.type);
    if (!handler) {
      // Unknown type: dead-letter immediately. Retrying cannot help, and
      // leaving it queued would make it a permanent no-op that hides real work.
      await finish(job.id, {
        status: 'dead_letter',
        lastErrorCode: 'no_handler',
        completedAt: new Date(),
      });
      summary.failed++;
      continue;
    }

    try {
      const result = await handler(job);
      if (result.status === 'reschedule') {
        await finish(job.id, {
          status: 'queued',
          payloadJson: result.payload,
          // Reset attempts: a reschedule is progress, not a failure, and
          // counting it against maxAttempts would kill long jobs partway.
          attempts: 0,
          runAfter: new Date(Date.now() + (result.delaySeconds ?? 0) * 1000),
        });
        summary.rescheduled++;
      } else {
        await finish(job.id, { status: 'succeeded', completedAt: new Date() });
        summary.done++;
      }
    } catch (err) {
      const exhausted = job.attempts >= job.maxAttempts;
      const code = err instanceof Error ? err.message.slice(0, 200) : 'error';
      console.error(`[jobs] ${job.type} ${job.id} failed:`, err);
      await finish(job.id, {
        status: exhausted ? 'dead_letter' : 'queued',
        lastErrorCode: code,
        runAfter: new Date(Date.now() + backoffSeconds(job.attempts) * 1000),
        ...(exhausted ? { completedAt: new Date() } : {}),
      });
      summary.failed++;
    }
  }

  return summary;
}

/**
 * Release jobs whose worker died mid-run.
 *
 * A crashed tick leaves a row stuck in 'processing' forever. The lease is
 * generous (15 min) because a legitimately slow handler must not be reclaimed
 * underneath itself; attempts was already incremented at claim time, so a
 * job that keeps dying still walks toward dead_letter rather than looping.
 */
export async function reclaimStuckJobs(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db
    .update(backgroundJob)
    .set({ status: 'queued', lockedAt: null, lockedBy: null })
    .where(
      and(
        eq(backgroundJob.status, 'processing'),
        lte(backgroundJob.lockedAt, cutoff)
      )
    )
    .returning({ id: backgroundJob.id });
  return rows.length;
}

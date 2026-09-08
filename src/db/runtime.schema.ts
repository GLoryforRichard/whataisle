import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { store } from './store.schema';

export type RuntimeStatus = 'queued' | 'provisioning' | 'retry' | 'ready' | 'failed' | 'archived';

/** Provisioning state contains only credential hashes; raw keys stay on the VM. */
export const storeRuntime = pgTable('store_runtime', {
  storeId: text('store_id').primaryKey().references(() => store.id),
  jobId: text('job_id').notNull(),
  kind: text('kind').notNull().default('provision').$type<'provision' | 'activate' | 'archive'>(),
  status: text('status').notNull().default('queued').$type<RuntimeStatus>(),
  attempts: integer('attempts').notNull().default(0),
  leaseTokenHash: text('lease_token_hash'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  workerId: text('worker_id'),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  port: integer('port'),
  runtimeTokenHash: text('runtime_token_hash'),
  runtimeVersion: text('runtime_version'),
  readyAt: timestamp('ready_at'),
  cleanupRequestedAt: timestamp('cleanup_requested_at'),
  cleanupRequestedBy: text('cleanup_requested_by'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  jobIdx: uniqueIndex('store_runtime_job_idx').on(t.jobId),
  readyIdx: index('store_runtime_ready_idx').on(t.status, t.nextAttemptAt),
  portIdx: uniqueIndex('store_runtime_port_idx').on(t.port),
}));

export const storeOwnerEntry = pgTable('store_owner_entry', {
  tokenHash: text('token_hash').primaryKey(),
  storeId: text('store_id').notNull().references(() => store.id),
  pinVersion: integer('pin_version').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
});

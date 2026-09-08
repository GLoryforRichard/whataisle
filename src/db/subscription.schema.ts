import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

/** Commercial records intentionally survive store-data cleanup. In particular,
 * deleting photos/maps must never reset the once-per-store introductory offer.
 * The application attaches a store only after verified payment and setup. */
export const storeSubscription = pgTable(
  'store_subscription',
  {
    ownerUserId: text('owner_user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    storeId: text('store_id'),
    currency: text('currency').notNull(),
    plan: text('plan').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    status: text('status').notNull().default('pending'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeScheduleId: text('stripe_schedule_id'),
    giftUsedAt: timestamp('gift_used_at', { withTimezone: true }),
    periodStart: timestamp('period_start', { withTimezone: true }),
    entitlementEnd: timestamp('entitlement_end', { withTimezone: true }),
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    cancelAtEnd: boolean('cancel_at_end').notNull().default(false),
    pendingPlan: text('pending_plan'),
    lastPaidInvoiceId: text('last_paid_invoice_id'),
    lastPaidAt: timestamp('last_paid_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('store_subscription_store_idx').on(table.storeId),
    uniqueIndex('store_subscription_stripe_idx').on(table.stripeSubscriptionId),
    index('store_subscription_lifecycle_idx').on(table.status, table.graceEndsAt),
  ]
);

/** Pending checkouts reserve shared-VM capacity, and test checkouts also reserve
 * their limited offer, until Stripe confirms expiry. Counting only successful
 * webhooks permits concurrent purchases beyond either approved limit. */
export const storeCheckout = pgTable(
  'store_checkout',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    plan: text('plan').notNull(),
    currency: text('currency').notNull(),
    isTest: boolean('is_test').notNull(),
    giftEligible: boolean('gift_eligible').notNull(),
    priceId: text('price_id').notNull(),
    amount: integer('amount').notNull(),
    status: text('status').notNull().default('reserved'),
    sessionId: text('session_id'),
    sessionUrl: text('session_url'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    locale: text('locale').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('store_checkout_session_idx').on(table.sessionId),
    index('store_checkout_owner_idx').on(table.ownerUserId, table.status),
    index('store_checkout_test_idx').on(table.isTest, table.status),
  ]
);

export const storeBillingEvent = pgTable('store_billing_event', {
  id: text('id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Transactional notification outbox. No retention-expiry email is enqueued. */
export const storeBillingNotice = pgTable('store_billing_notice', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

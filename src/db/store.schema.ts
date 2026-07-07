import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

/**
 * Tenant tables for WhatAisle stores.
 *
 * Every tenant-scoped table carries a NOT NULL `storeId` with cascade delete:
 * account closure means immediate, complete deletion (requirements §7).
 * All access to these tables must go through src/data/ so store_id scoping
 * is enforced in one place.
 */

export type StoreStatus = 'active' | 'closed';
export type FloorMapStatus = 'none' | 'draft' | 'awaiting_confirm' | 'published';
export type ShelfStatus = 'active' | 'deleted';

/**
 * Shape of the floor map JSON produced by the internal mapping tool.
 * Shapes are drawn over a normalized viewBox; shelfCode links a shape
 * to a `shelf` row by (storeId, code).
 */
export interface FloorMapJson {
  viewBox: { width: number; height: number };
  shapes: Array<{
    shelfCode: string;
    kind: 'rect' | 'polygon';
    /** rect: [x, y, w, h]; polygon: [x1, y1, x2, y2, ...] */
    coords: number[];
    labelPos?: [number, number];
    /** whether this shelf distinguishes left/right sides */
    sides?: boolean;
  }>;
}

export const store = pgTable(
  'store',
  {
    id: text('id').primaryKey(),
    // Permanent subdomain handle; immutable after creation (requirements §4.1).
    handle: text('handle').notNull(),
    // One account maps to one store (requirements §3).
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    displayNameZh: text('display_name_zh'),
    logoKey: text('logo_key'),
    openingHours: jsonb('opening_hours'),
    announcement: text('announcement'),
    announcementZh: text('announcement_zh'),
    status: text('status').notNull().default('active').$type<StoreStatus>(),
    // Staff enter with a store-level PIN — no accounts (requirements §4.2).
    staffPinHash: text('staff_pin_hash'),
    // Bumping the version invalidates all outstanding staff cookies.
    pinVersion: integer('pin_version').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
  },
  (table) => ({
    storeHandleIdx: uniqueIndex('store_handle_idx').on(table.handle),
    storeOwnerUserIdIdx: uniqueIndex('store_owner_user_id_idx').on(
      table.ownerUserId
    ),
  })
);

export const storeTermsAcceptance = pgTable(
  'store_terms_acceptance',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    termsVersion: text('terms_version').notNull(),
    acceptedAt: timestamp('accepted_at').notNull().defaultNow(),
  },
  (table) => ({
    storeTermsAcceptanceUserIdIdx: index('store_terms_acceptance_user_id_idx').on(
      table.userId
    ),
  })
);

export const shelf = pgTable(
  'shelf',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    // Shelf code as printed on the physical aisle sign, e.g. "B4".
    code: text('code').notNull(),
    label: text('label'),
    labelZh: text('label_zh'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('active').$type<ShelfStatus>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    shelfStoreIdCodeIdx: uniqueIndex('shelf_store_id_code_idx').on(
      table.storeId,
      table.code
    ),
    shelfStoreIdIdx: index('shelf_store_id_idx').on(table.storeId),
  })
);

export const floorMap = pgTable(
  'floor_map',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('none').$type<FloorMapStatus>(),
    mapJson: jsonb('map_json').$type<FloorMapJson>(),
    version: integer('version').notNull().default(1),
    // Owner's note when sending a draft back for revision.
    ownerNote: text('owner_note'),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    floorMapStoreIdIdx: uniqueIndex('floor_map_store_id_idx').on(table.storeId),
  })
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    // Null for system-initiated actions.
    actorUserId: text('actor_user_id'),
    storeId: text('store_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detailJson: jsonb('detail_json'),
    isImpersonation: boolean('is_impersonation').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    auditLogStoreIdIdx: index('audit_log_store_id_idx').on(table.storeId),
    auditLogActorUserIdIdx: index('audit_log_actor_user_id_idx').on(
      table.actorUserId
    ),
    auditLogCreatedAtIdx: index('audit_log_created_at_idx').on(table.createdAt),
  })
);

/**
 * Fixed-window rate limiting (PIN attempts, shopper search).
 * Key encodes the scope, e.g. `pin:<storeId>:<ipHash>`.
 */
export const rateLimit = pgTable('rate_limit', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start').notNull(),
  count: integer('count').notNull().default(0),
});

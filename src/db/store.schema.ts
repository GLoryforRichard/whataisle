import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

/** Embedding dimensionality — gemini-embedding-001 output truncated to 768. */
export const EMBEDDING_DIM = 768;

/**
 * Tenant tables for WhatAisle stores.
 *
 * Every tenant-scoped table carries a NOT NULL `storeId` with cascade delete:
 * account closure means immediate, complete deletion (requirements §7).
 * All access to these tables must go through src/data/ so store_id scoping
 * is enforced in one place.
 */

export type StoreStatus =
  | 'onboarding'
  | 'live'
  | 'suspended'
  | 'closing'
  | 'closed';
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
    status: text('status').notNull().default('onboarding').$type<StoreStatus>(),
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

// ---------------------------------------------------------------------------
// Platform back office: support tickets + announcements (§7)
// ---------------------------------------------------------------------------

export const supportTicket = pgTable(
  'support_ticket',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    openedVia: text('opened_via').notNull().default('owner'),
    subject: text('subject').notNull(),
    body: text('body'),
    // Store identity + context auto-attached at report time.
    contextJson: jsonb('context_json'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    supportTicketStatusIdx: index('support_ticket_status_idx').on(table.status),
  })
);

export const announcement = pgTable('announcement', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  titleZh: text('title_zh'),
  body: text('body').notNull(),
  bodyZh: text('body_zh'),
  publishedAt: timestamp('published_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sales-assisted onboarding and durable platform work
// ---------------------------------------------------------------------------

export type SalesLeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'won'
  | 'lost';

export const salesLead = pgTable(
  'sales_lead',
  {
    id: text('id').primaryKey(),
    storeName: text('store_name').notNull(),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    city: text('city').notNull(),
    province: text('province').notNull(),
    storeCount: integer('store_count').notNull().default(1),
    preferredLanguage: text('preferred_language')
      .notNull()
      .$type<'en' | 'zh'>(),
    message: text('message'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    marketingConsentAt: timestamp('marketing_consent_at'),
    reporterHash: text('reporter_hash').notNull(),
    status: text('status').notNull().default('new').$type<SalesLeadStatus>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    salesLeadStatusCreatedIdx: index('sales_lead_status_created_idx').on(
      table.status,
      table.createdAt
    ),
    salesLeadEmailIdx: index('sales_lead_email_idx').on(table.email),
  })
);

export type StoreInviteStatus = 'pending' | 'accepted' | 'revoked';

export const storeInvite = pgTable(
  'store_invite',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<StoreInviteStatus>(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    storeInviteTokenHashIdx: uniqueIndex('store_invite_token_hash_idx').on(
      table.tokenHash
    ),
    storeInviteEmailStatusIdx: index('store_invite_email_status_idx').on(
      table.email,
      table.status
    ),
  })
);

export type JobType =
  | 'shelf_scan'
  | 'product_enrichment'
  | 'video_finalize'
  | 'notification'
  | 'data_delete';
export type JobStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'dead_letter';

export const backgroundJob = pgTable(
  'background_job',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').references(() => store.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull().$type<JobType>(),
    status: text('status').notNull().default('queued').$type<JobStatus>(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after').notNull().defaultNow(),
    lockedAt: timestamp('locked_at'),
    lockedBy: text('locked_by'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    backgroundJobIdempotencyIdx: uniqueIndex(
      'background_job_idempotency_idx'
    ).on(table.idempotencyKey),
    backgroundJobRunIdx: index('background_job_run_idx').on(
      table.status,
      table.runAfter
    ),
    backgroundJobStoreIdx: index('background_job_store_idx').on(table.storeId),
  })
);

export const impersonationGrant = pgTable(
  'impersonation_grant',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    impersonationGrantTokenIdx: uniqueIndex(
      'impersonation_grant_token_idx'
    ).on(table.tokenHash),
    impersonationGrantExpiryIdx: index('impersonation_grant_expiry_idx').on(
      table.expiresAt
    ),
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

// ---------------------------------------------------------------------------
// Store memory: products, aliases, locations, scan evidence
// ---------------------------------------------------------------------------

export type ProductStatus = 'active' | 'unlocated' | 'deleted';
export type ConfidenceState = 'normal' | 'doubted';
export type AliasLang = 'en' | 'zh' | 'pinyin' | 'misspelling';
export type AliasSource = 'ai' | 'manual';
export type ScanPhotoStatus = 'pending' | 'recognizing' | 'done' | 'failed';

export const product = pgTable(
  'product',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    canonicalName: text('canonical_name').notNull(),
    nameZh: text('name_zh'),
    category: text('category'),
    // Canonical name + all aliases joined with " · "; the embedding input and
    // the trigram-search haystack.
    searchText: text('search_text').notNull().default(''),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    // How many times this product has been photographed — the "seen N×" trust
    // signal (requirements §2). Boosts ranking; never hides.
    evidenceCount: integer('evidence_count').notNull().default(1),
    confidenceState: text('confidence_state')
      .notNull()
      .default('normal')
      .$type<ConfidenceState>(),
    status: text('status').notNull().default('active').$type<ProductStatus>(),
    thumbnailKey: text('thumbnail_key'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    productStoreIdCanonicalIdx: uniqueIndex('product_store_id_canonical_idx').on(
      table.storeId,
      table.canonicalName
    ),
    productStoreIdStatusIdx: index('product_store_id_status_idx').on(
      table.storeId,
      table.status
    ),
    // HNSW cosine index for vector search (custom SQL adds this — drizzle-kit's
    // .using('hnsw', ...) support is version-sensitive, so it's in the raw SQL
    // migration alongside the trigram GIN index).
  })
);

export const productAlias = pgTable(
  'product_alias',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    lang: text('lang').notNull().$type<AliasLang>(),
    source: text('source').notNull().default('ai').$type<AliasSource>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    productAliasStoreIdAliasIdx: index('product_alias_store_id_alias_idx').on(
      table.storeId,
      table.alias
    ),
    productAliasProductIdIdx: index('product_alias_product_id_idx').on(
      table.productId
    ),
  })
);

export const productLocation = pgTable(
  'product_location',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    shelfId: text('shelf_id')
      .notNull()
      .references(() => shelf.id, { onDelete: 'cascade' }),
    // Left/right side of the shelf, when the map distinguishes sides.
    side: text('side').$type<'L' | 'R'>(),
    seenCount: integer('seen_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    status: text('status').notNull().default('active').$type<ShelfStatus>(),
  },
  (table) => ({
    // A product can have multiple active locations (regular shelf + promo
    // end-cap), so uniqueness is per (product, shelf, side) — requirements §8.
    // The index is created NULLS NOT DISTINCT in migration 0013 (drizzle 0.39
    // can't express that inline) so side = NULL ("no L/R") still dedupes per
    // (product, shelf) and re-scans bump seen_count instead of duplicating.
    productLocationUniqueIdx: uniqueIndex('product_location_unique_idx').on(
      table.productId,
      table.shelfId,
      table.side
    ),
    productLocationStoreIdIdx: index('product_location_store_id_idx').on(
      table.storeId
    ),
    productLocationShelfIdIdx: index('product_location_shelf_id_idx').on(
      table.shelfId
    ),
  })
);

export const scanBatch = pgTable(
  'scan_batch',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    shelfId: text('shelf_id')
      .notNull()
      .references(() => shelf.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('staff'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    scanBatchStoreIdIdx: index('scan_batch_store_id_idx').on(table.storeId),
  })
);

export const scanPhoto = pgTable(
  'scan_photo',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    batchId: text('batch_id')
      .notNull()
      .references(() => scanBatch.id, { onDelete: 'cascade' }),
    shelfId: text('shelf_id')
      .notNull()
      .references(() => shelf.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key'),
    status: text('status').notNull().default('pending').$type<ScanPhotoStatus>(),
    errorMessage: text('error_message'),
    // Faces detected in the shelf photo are blurred before persistence (§10).
    facesBlurred: boolean('faces_blurred').notNull().default(false),
    detectedCount: integer('detected_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (table) => ({
    scanPhotoBatchIdIdx: index('scan_photo_batch_id_idx').on(table.batchId),
    scanPhotoStoreIdIdx: index('scan_photo_store_id_idx').on(table.storeId),
  })
);

// ---------------------------------------------------------------------------
// AI usage metering — per-store cost accounting (back-office only, §7)
// ---------------------------------------------------------------------------

export type AiUsageKind =
  // legacy kinds from the retired two-stage Qwen scan (historic rows exist)
  | 'vision_stage1'
  | 'vision_stage2'
  // rows-hd scan engine (OpenRouter): row detect / band detect / grid readout
  | 'scan_rows'
  | 'scan_detect'
  | 'scan_readout'
  // landing try-out: precheck gate + fast detection
  | 'try_precheck'
  | 'try_detect'
  | 'alias'
  | 'embed'
  | 'transcribe'
  | 'identify'
  | 'answer';

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id'),
    kind: text('kind').notNull().$type<AiUsageKind>(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    images: integer('images').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    refId: text('ref_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    aiUsageLogStoreIdIdx: index('ai_usage_log_store_id_idx').on(
      table.storeId,
      table.createdAt
    ),
  })
);

// ---------------------------------------------------------------------------
// Shopper-facing signals: search logs, misses, feedback, review tasks
// ---------------------------------------------------------------------------

export type InputMethod = 'text' | 'voice' | 'photo';
export type AnswerTone = 'confident' | 'multi' | 'category' | 'none';
export type MissClassification = 'unclassified' | 'not_carried' | 'needs_scan';

export const searchLog = pgTable(
  'search_log',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    queryText: text('query_text').notNull(),
    queryLang: text('query_lang'),
    inputMethod: text('input_method').notNull().$type<InputMethod>(),
    answerTone: text('answer_tone').$type<AnswerTone>(),
    resultCount: integer('result_count').notNull().default(0),
    // Staff test searches are excluded from statistics (requirements §4.2).
    isTest: boolean('is_test').notNull().default(false),
    // Content-safety deflections are excluded from top-search stats (§10).
    isDeflected: boolean('is_deflected').notNull().default(false),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    searchLogStoreIdCreatedIdx: index('search_log_store_id_created_idx').on(
      table.storeId,
      table.createdAt
    ),
  })
);

export const missInsight = pgTable(
  'miss_insight',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    queryText: text('query_text').notNull(),
    hitlessCount: integer('hitless_count').notNull().default(1),
    classification: text('classification')
      .notNull()
      .default('unclassified')
      .$type<MissClassification>(),
    status: text('status').notNull().default('open'),
    lastSearchedAt: timestamp('last_searched_at').notNull().defaultNow(),
  },
  (table) => ({
    missInsightStoreQueryIdx: uniqueIndex('miss_insight_store_query_idx').on(
      table.storeId,
      table.queryText
    ),
  })
);

export const feedbackReport = pgTable(
  'feedback_report',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: text('location_id'),
    // sha256(ip + ua + day) — dedupes "not there" reports without storing PII.
    reporterHash: text('reporter_hash').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    feedbackReportUniqueIdx: uniqueIndex('feedback_report_unique_idx').on(
      table.productId,
      table.reporterHash
    ),
    feedbackReportStoreIdIdx: index('feedback_report_store_id_idx').on(
      table.storeId
    ),
  })
);

// ---------------------------------------------------------------------------
// Store onboarding: walk-through videos + the platform mapping queue (§6)
// ---------------------------------------------------------------------------

export type StoreVideoStatus = 'uploading' | 'received';
export type MappingTicketType = 'initial' | 'layout_update';
export type MappingTicketStatus =
  | 'todo'
  | 'drawing'
  | 'awaiting_confirm'
  | 'published'
  | 'returned';

export const storeVideo = pgTable(
  'store_video',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    filename: text('filename'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    status: text('status').notNull().default('uploading').$type<StoreVideoStatus>(),
    // Which chunk indices have been received (resumable upload state).
    chunksReceived: jsonb('chunks_received').$type<number[]>(),
    totalChunks: integer('total_chunks').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    storeVideoStoreIdIdx: index('store_video_store_id_idx').on(table.storeId),
  })
);

export const mappingTicket = pgTable(
  'mapping_ticket',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('initial').$type<MappingTicketType>(),
    videoId: text('video_id'),
    status: text('status').notNull().default('todo').$type<MappingTicketStatus>(),
    // Owner's note when returning a draft, or the layout-change description.
    note: text('note'),
    dueAt: timestamp('due_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    mappingTicketStatusIdx: index('mapping_ticket_status_idx').on(table.status),
    mappingTicketStoreIdIdx: index('mapping_ticket_store_id_idx').on(
      table.storeId
    ),
  })
);

export const reviewTask = pgTable(
  'review_task',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => product.id, {
      onDelete: 'cascade',
    }),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => ({
    reviewTaskStoreIdStatusIdx: index('review_task_store_id_status_idx').on(
      table.storeId,
      table.status
    ),
  })
);

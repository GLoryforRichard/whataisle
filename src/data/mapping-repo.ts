import 'server-only';

import { getDb } from '@/db';
import {
  type FloorMapJson,
  auditLog,
  floorMap,
  mappingTicket,
  shelf,
  store,
  storeVideo,
} from '@/db/store.schema';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * Data access for the store-video → mapping-ticket → floor-map pipeline (§6).
 *
 * Store-scoped operations bind storeId; the platform-side queue reads across
 * stores and lives only in the back office (admin-guarded routes).
 */
export function mappingRepo(storeId: string) {
  return {
    async createVideo(input: {
      storageKey: string;
      filename: string | null;
      totalChunks: number;
    }) {
      const db = await getDb();
      const id = nanoid();
      await db.insert(storeVideo).values({
        id,
        storeId,
        storageKey: input.storageKey,
        filename: input.filename,
        totalChunks: input.totalChunks,
        chunksReceived: [],
        status: 'uploading',
      });
      return id;
    },

    async recordChunk(videoId: string, chunkIndex: number, sizeDelta: number) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(storeVideo)
        .where(and(eq(storeVideo.storeId, storeId), eq(storeVideo.id, videoId)))
        .limit(1);
      const v = rows[0];
      if (!v) return null;
      const received = new Set(v.chunksReceived ?? []);
      received.add(chunkIndex);
      await db
        .update(storeVideo)
        .set({
          chunksReceived: Array.from(received).sort((a, b) => a - b),
          sizeBytes: v.sizeBytes + sizeDelta,
        })
        .where(eq(storeVideo.id, videoId));
      return { received: received.size, total: v.totalChunks };
    },

    async completeVideo(videoId: string) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(storeVideo)
        .where(and(eq(storeVideo.storeId, storeId), eq(storeVideo.id, videoId)))
        .limit(1);
      const v = rows[0];
      if (!v) return null;

      await db
        .update(storeVideo)
        .set({ status: 'received', completedAt: new Date() })
        .where(eq(storeVideo.id, videoId));

      // Open (or reuse) an initial mapping ticket for this store.
      const existingTicket = await db
        .select({ id: mappingTicket.id })
        .from(mappingTicket)
        .where(
          and(
            eq(mappingTicket.storeId, storeId),
            eq(mappingTicket.type, 'initial')
          )
        )
        .limit(1);
      let ticketId: string;
      if (existingTicket.length > 0) {
        ticketId = existingTicket[0].id;
        await db
          .update(mappingTicket)
          .set({ videoId, status: 'todo', updatedAt: new Date() })
          .where(eq(mappingTicket.id, ticketId));
      } else {
        ticketId = nanoid();
        await db.insert(mappingTicket).values({
          id: ticketId,
          storeId,
          type: 'initial',
          videoId,
          status: 'todo',
        });
      }
      return { videoId, ticketId };
    },

    async getFloorMap() {
      const db = await getDb();
      const rows = await db
        .select()
        .from(floorMap)
        .where(eq(floorMap.storeId, storeId))
        .limit(1);
      return rows[0] ?? null;
    },

    async getInitialTicket() {
      const db = await getDb();
      const rows = await db
        .select()
        .from(mappingTicket)
        .where(eq(mappingTicket.storeId, storeId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Owner confirms the published draft → live. */
    async confirmMap() {
      const db = await getDb();
      await db.transaction(async (tx) => {
        await tx
          .update(floorMap)
          .set({ status: 'published', ownerNote: null, updatedAt: new Date() })
          .where(eq(floorMap.storeId, storeId));
        await tx
          .update(store)
          .set({ status: 'live', updatedAt: new Date() })
          .where(eq(store.id, storeId));
        await tx.insert(auditLog).values({
          id: nanoid(),
          storeId,
          action: 'floor_map.confirm',
          targetType: 'floor_map',
          detailJson: { storeStatus: 'live' },
        });
      });
    },

    /** Owner returns the draft with a note. */
    async returnMap(note: string) {
      const db = await getDb();
      await db
        .update(floorMap)
        .set({ status: 'draft', ownerNote: note, updatedAt: new Date() })
        .where(eq(floorMap.storeId, storeId));
      await db
        .update(mappingTicket)
        .set({ status: 'returned', note, updatedAt: new Date() })
        .where(
          and(
            eq(mappingTicket.storeId, storeId),
            eq(mappingTicket.type, 'initial')
          )
        );
    },

    /** File a later layout-update request (a note or a fresh video). */
    async requestLayoutUpdate(note: string) {
      const db = await getDb();
      const id = nanoid();
      await db.insert(mappingTicket).values({
        id,
        storeId,
        type: 'layout_update',
        status: 'todo',
        note,
      });
      return id;
    },
  };
}

/**
 * Publish a hand-drawn map to a store (platform/admin operation). Ensures every
 * referenced shelf code exists (auto-creating missing ones so nothing is lost),
 * writes the floor map as a published draft awaiting owner confirmation, and
 * links the ticket. Runs outside the tenant repo because it's an admin action.
 */
export async function publishFloorMap(input: {
  storeId: string;
  ticketId: string;
  mapJson: FloorMapJson;
  actorUserId: string;
}) {
  const db = await getDb();

  // Auto-link shelves: any shelf code in the map that doesn't exist yet is
  // created, so pre-map scans and the drawn map converge (no data lost, §6).
  const existing = await db
    .select({ code: shelf.code })
    .from(shelf)
    .where(eq(shelf.storeId, input.storeId));
  const existingCodes = new Set(existing.map((s) => s.code));
  const mapCodes = Array.from(
    new Set(input.mapJson.shapes.map((s) => s.shelfCode))
  );
  const missing = mapCodes.filter((c) => !existingCodes.has(c));
  if (missing.length > 0) {
    await db.insert(shelf).values(
      missing.map((code, i) => ({
        id: nanoid(),
        storeId: input.storeId,
        code,
        sortOrder: 1000 + i,
      }))
    );
  }

  const existingMap = await db
    .select({ id: floorMap.id, version: floorMap.version })
    .from(floorMap)
    .where(eq(floorMap.storeId, input.storeId))
    .limit(1);

  if (existingMap.length > 0) {
    await db
      .update(floorMap)
      .set({
        status: 'awaiting_confirm',
        mapJson: input.mapJson,
        version: existingMap[0].version + 1,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(floorMap.storeId, input.storeId));
  } else {
    await db.insert(floorMap).values({
      id: nanoid(),
      storeId: input.storeId,
      status: 'awaiting_confirm',
      mapJson: input.mapJson,
      publishedAt: new Date(),
    });
  }

  await db
    .update(mappingTicket)
    .set({ status: 'awaiting_confirm', updatedAt: new Date() })
    .where(eq(mappingTicket.id, input.ticketId));

  await db.insert(auditLog).values({
    id: nanoid(),
    actorUserId: input.actorUserId,
    storeId: input.storeId,
    action: 'floor_map.publish',
    targetType: 'floor_map',
    detailJson: { shelfCount: mapCodes.length, createdShelves: missing },
  });
}

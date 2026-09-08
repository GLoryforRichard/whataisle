import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getStoreMap } from '@/lib/store-map';
import {
  checkStorePin,
  getStoreRuntime,
  hasStoreSession,
  isSameStoreOrigin,
  runtimeDenied,
  setStoreSession,
} from '@/lib/store-runtime';
import { validateFloorMap, assertShelfContinuity, type FloorMap } from '@/lib/floor-map-model.mjs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  if (!isSameStoreOrigin(req)) return runtimeDenied(403, 'Please use this store’s own page.');
  try {
    const config = await getStoreRuntime();
    if (!config.managed) return runtimeDenied(403, 'This store uses its existing floor map.');
    if (!config.accessAllowed) return runtimeDenied(402, 'Store subscription is inactive.');
    const body = await req.json();
    const previous = await getStoreMap();
    if (previous && !hasStoreSession(req, config, 'owner'))
      return runtimeDenied(403, 'Only the owner can edit an opened store’s map.');
    if (!previous && !config.setupAllowed) return runtimeDenied(403, 'Store setup is unavailable.');
    if (!previous) {
      const denied = await checkStorePin(req, config, body.pin);
      if (denied) return denied;
    }
    let map: FloorMap;
    try {
      map = validateFloorMap(body.map);
      assertShelfContinuity(previous, map);
    } catch (error) {
      return runtimeDenied(400, error instanceof Error ? error.message : 'Invalid map');
    }
    if (map.revision !== (previous?.revision || 0))
      return runtimeDenied(409, 'The map changed on another device. Reload before editing.');
    const db = await getDb();
    const collection = db.collection<FloorMap & { _id: string }>('store_floor_map');
    const saved = { ...map, revision: map.revision + 1 };
    if (previous) {
      const updated = await collection.replaceOne(
        { _id: 'published', revision: map.revision },
        saved
      );
      if (!updated.modifiedCount)
        return runtimeDenied(409, 'The map changed on another device. Reload before editing.');
    } else {
      try {
        await collection.insertOne({ _id: 'published', ...saved });
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          return runtimeDenied(409, 'This store has already opened. Reload the page.');
        throw error;
      }
    }
    const result = NextResponse.json({ ok: true, map: saved });
    setStoreSession(result, config);
    return result;
  } catch {
    return runtimeDenied(503, 'Could not save the map. Your draft is still on this device.');
  }
}

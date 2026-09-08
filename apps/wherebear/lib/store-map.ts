import 'server-only';
import { getDb } from './mongodb';
import { isManagedStore } from './store-runtime';
import { SHELVES, buildShelfContext } from './shelves';
import type { FloorMap } from './floor-map-model.mjs';
export async function getStoreMap(): Promise<FloorMap | null> {
  if (!isManagedStore()) return null;
  const db = await getDb();
  const record = await db
    .collection<FloorMap & { _id: string }>('store_floor_map')
    .findOne({ _id: 'published' });
  if (!record) return null;
  return {
    revision: record.revision,
    width: record.width,
    height: record.height,
    shelves: record.shelves,
  };
}
export async function storeShelfExists(id: string) {
  if (!isManagedStore()) return SHELVES.some((s) => s.code === id);
  return (await getStoreMap())?.shelves.some((s) => s.id === id) ?? false;
}
export async function getStoreShelfCatalog() {
  if (!isManagedStore()) return SHELVES;
  return (
    (await getStoreMap())?.shelves.map((s) => ({
      code: s.id,
      description: `${s.code} ${s.description}`.trim(),
      categories: s.description ? [s.description] : [],
    })) ?? []
  );
}
export async function buildStoreShelfContext(id: string) {
  if (!isManagedStore()) return buildShelfContext(id);
  const shelf = (await getStoreMap())?.shelves.find((s) => s.id === id);
  return shelf ? `${shelf.code} — ${shelf.description}` : id;
}

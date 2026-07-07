'use client';

/**
 * IndexedDB-backed outbox for shelf photos, so an in-progress scan survives a
 * screen lock, app switch, or network drop (requirements §9: "locking the
 * screen or switching apps loses nothing"). Photos are stored as blobs and
 * removed once processed.
 */

const DB_NAME = 'whataisle-scan';
const STORE = 'photos';

export interface OutboxPhoto {
  id: string;
  shelfId: string;
  blob: Blob;
  createdAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function outboxPut(photo: OutboxPhoto): Promise<void> {
  await tx('readwrite', (s) => s.put(photo));
}

export async function outboxDelete(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function outboxListByShelf(
  shelfId: string
): Promise<OutboxPhoto[]> {
  const all = await tx<OutboxPhoto[]>('readonly', (s) => s.getAll());
  return (all ?? []).filter((p) => p.shelfId === shelfId);
}

export function outboxSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

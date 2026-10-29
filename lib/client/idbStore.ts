import { createMemoryStore, type QueueStore, type UploadItem } from '../uploadQueue';

const DB_NAME = 'moradoksiang';
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB-backed queue store (blobs survive reloads); falls back to memory if IDB is unavailable. */
export async function createIdbStore(recordToken: string): Promise<QueueStore> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return createMemoryStore();
  }
  return {
    async put(item) {
      await tx(db, 'readwrite', (s) => s.put(item));
    },
    async delete(id) {
      await tx(db, 'readwrite', (s) => s.delete(id));
    },
    async all() {
      const items = await tx<UploadItem[]>(db, 'readonly', (s) => s.getAll());
      return items.filter((i) => i.recordToken === recordToken);
    },
  };
}

export interface UploadItem {
  id: string;
  recordToken: string;
  questionId: string;
  blob?: Blob;
  mime?: string;
  skip?: boolean;
  createdAt: number;
}

export interface QueueStore {
  put(item: UploadItem): Promise<void>;
  delete(id: string): Promise<void>;
  all(): Promise<UploadItem[]>;
}

export type SendResult = 'ok' | 'retry' | 'drop';

/** 2xx ok; timeouts/rate limits/5xx retry; other 4xx will never succeed -> drop */
export function classifyStatus(status: number): SendResult {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

export const nextDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

export function createMemoryStore(): QueueStore {
  const items = new Map<string, UploadItem>();
  return {
    async put(item) {
      items.set(item.id, item);
    },
    async delete(id) {
      items.delete(id);
    },
    async all() {
      return [...items.values()];
    },
  };
}

interface Options {
  store: QueueStore;
  send: (item: UploadItem) => Promise<SendResult>;
  sleep?: (ms: number) => Promise<void>;
}

/** Persist-first upload queue: answers survive network drops and page reloads. */
export function createUploadQueue({ store, send, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: Options) {
  const listeners = new Set<(pending: number) => void>();
  let running: Promise<void> | null = null;
  let stopped = false;

  const sorted = async () => (await store.all()).sort((a, b) => a.createdAt - b.createdAt);
  const notify = async () => {
    const n = (await store.all()).length;
    listeners.forEach((l) => l(n));
  };

  async function attempt(item: UploadItem): Promise<SendResult> {
    try {
      return await send(item);
    } catch {
      return 'retry';
    }
  }

  async function drain() {
    for (let items = await sorted(); items.length && !stopped; items = await sorted()) {
      const item = items[0];
      for (let n = 0; !stopped; n++) {
        const result = await attempt(item);
        if (result !== 'retry') {
          await store.delete(item.id);
          await notify();
          break;
        }
        await sleep(nextDelay(n));
      }
    }
  }

  return {
    store,
    async enqueue(item: UploadItem) {
      for (const old of await store.all()) if (old.questionId === item.questionId && old.recordToken === item.recordToken) await store.delete(old.id);
      await store.put(item);
      await notify();
    },
    flush(): Promise<void> {
      stopped = false;
      running ??= drain().finally(() => {
        running = null;
      });
      return running;
    },
    stop() {
      stopped = true;
    },
    async pending() {
      return (await store.all()).length;
    },
    subscribe(fn: (pending: number) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;

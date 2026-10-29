import { describe, expect, it } from 'vitest';
import { classifyStatus, createMemoryStore, createUploadQueue, nextDelay, type UploadItem } from '@/lib/uploadQueue';

const item = (id: string, extra: Partial<UploadItem> = {}): UploadItem => ({
  id,
  recordToken: 't',
  questionId: `q-${id}`,
  blob: new Blob(['x'], { type: 'audio/webm' }),
  mime: 'audio/webm',
  createdAt: Number(id.replace(/\D/g, '')) || 0,
  ...extra,
});

describe('classifyStatus', () => {
  it.each([
    [200, 'ok'],
    [201, 'ok'],
    [404, 'drop'],
    [415, 'drop'],
    [422, 'drop'],
    [408, 'retry'],
    [429, 'retry'],
    [500, 'retry'],
    [502, 'retry'],
  ])('%i -> %s', (status, out) => {
    expect(classifyStatus(status)).toBe(out);
  });
});

describe('nextDelay', () => {
  it('backs off exponentially from 1s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(nextDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe('createUploadQueue', () => {
  function setup(responses: ('ok' | 'retry' | 'drop' | 'throw')[]) {
    const store = createMemoryStore();
    const sent: string[] = [];
    const delays: number[] = [];
    let call = 0;
    const queue = createUploadQueue({
      store,
      send: async (it) => {
        sent.push(it.id);
        const r = responses[call++] ?? 'ok';
        if (r === 'throw') throw new TypeError('network');
        return r;
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    return { store, queue, sent, delays };
  }

  it('persists before sending and removes after success', async () => {
    const { store, queue, sent } = setup(['ok']);
    await queue.enqueue(item('a1'));
    await queue.flush();
    expect(sent).toEqual(['a1']);
    expect(await store.all()).toEqual([]);
  });

  it('retries network errors and 5xx with backoff until success', async () => {
    const { store, queue, sent, delays } = setup(['throw', 'retry', 'ok']);
    await queue.enqueue(item('a1'));
    await queue.flush();
    expect(sent).toEqual(['a1', 'a1', 'a1']);
    expect(delays).toEqual([1000, 2000]);
    expect(await store.all()).toEqual([]);
  });

  it('drops items the server will never accept', async () => {
    const { store, queue } = setup(['drop']);
    await queue.enqueue(item('a1'));
    await queue.flush();
    expect(await store.all()).toEqual([]);
  });

  it('sends in creation order, one at a time', async () => {
    const { queue, sent } = setup([]);
    await queue.store.put(item('a3'));
    await queue.store.put(item('a1'));
    await queue.store.put(item('a2'));
    await queue.flush();
    expect(sent).toEqual(['a1', 'a2', 'a3']);
  });

  it('flush resumes items left over from a previous page load', async () => {
    const { store, queue, sent } = setup([]);
    await store.put(item('a1'));
    await queue.flush();
    expect(sent).toEqual(['a1']);
  });

  it('concurrent flush calls do not double-send', async () => {
    const { queue, sent } = setup([]);
    await queue.store.put(item('a1'));
    await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
    expect(sent).toEqual(['a1']);
  });

  it('notifies pending count changes', async () => {
    const { queue } = setup(['ok', 'ok']);
    const counts: number[] = [];
    queue.subscribe((n) => counts.push(n));
    await queue.enqueue(item('a1'));
    await queue.enqueue(item('a2'));
    await queue.flush();
    expect(counts.at(-1)).toBe(0);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(1);
  });

  it('a newer item for the same question replaces the queued one', async () => {
    const { queue, sent } = setup([]);
    await queue.store.put(item('a1', { questionId: 'same' }));
    await queue.enqueue(item('a2', { questionId: 'same' }));
    await queue.flush();
    expect(sent).toEqual(['a2']);
  });

  it('stop() halts a retry loop', async () => {
    const store = createMemoryStore();
    let sends = 0;
    const queue = createUploadQueue({
      store,
      send: async () => {
        sends++;
        return 'retry';
      },
      sleep: async () => {
        if (sends >= 3) queue.stop();
      },
    });
    await queue.enqueue(item('a1'));
    await queue.flush();
    expect(sends).toBe(3);
    expect(await store.all()).toHaveLength(1);
  });
});

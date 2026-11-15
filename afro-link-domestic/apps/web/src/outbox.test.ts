import { describe, expect, it, vi } from 'vitest';
import {
  enqueue,
  flushOutbox,
  loadOutbox,
  outboxCount,
  OutboxItem,
  requestBackgroundSync,
} from './outbox';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => map.set(key, value),
  };
}

describe('outbox', () => {
  it('enqueues and loads items', () => {
    const store = fakeStorage();
    enqueue('/advances', { amountEtb: 5000 }, store);
    enqueue('/shipments/x/events', { kind: 'delivered' }, store);
    expect(outboxCount(store)).toBe(2);
    const items = loadOutbox(store);
    expect(items[0]!.path).toBe('/advances');
    expect(items[1]!.body).toEqual({ kind: 'delivered' });
    expect(items[0]!.id).toBeTruthy();
  });

  it('tolerates missing storage and corrupt data', () => {
    expect(loadOutbox(undefined)).toEqual([]);
    const store = fakeStorage();
    store.setItem('afrolink.outbox', 'not-json');
    expect(loadOutbox(store)).toEqual([]);
  });

  it('flushes queued items and clears them on success', async () => {
    const store = fakeStorage();
    enqueue('/advances', { amountEtb: 5000 }, store);
    enqueue('/loads', { weightTons: 10 }, store);

    const send = vi.fn().mockResolvedValue({});
    const sent = await flushOutbox(send, store);

    expect(sent).toBe(2);
    expect(outboxCount(store)).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0]![0] as OutboxItem).path).toBe('/advances');
  });

  it('keeps failed items queued for the next attempt', async () => {
    const store = fakeStorage();
    enqueue('/advances', { amountEtb: 5000 }, store);
    enqueue('/loads', { weightTons: 10 }, store);

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce({});
    const sent = await flushOutbox(send, store);

    expect(sent).toBe(1);
    const remaining = loadOutbox(store);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.path).toBe('/advances');
  });

  it('is a safe no-op when background sync is unavailable', () => {
    expect(() => requestBackgroundSync()).not.toThrow();
  });
});

export interface OutboxItem {
  id: string;
  path: string;
  body: unknown;
  queuedAt: string;
}

const OUTBOX_KEY = 'afrolink.outbox';

function storage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function loadOutbox(store: Storage | undefined = storage()): OutboxItem[] {
  if (!store) return [];
  try {
    const raw = store.getItem(OUTBOX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

export function outboxCount(store?: Storage): number {
  return loadOutbox(store).length;
}

function saveOutbox(items: OutboxItem[], store: Storage | undefined): void {
  store?.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export function enqueue(
  path: string,
  body: unknown,
  store: Storage | undefined = storage(),
): OutboxItem {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    path,
    body,
    queuedAt: new Date().toISOString(),
  };
  saveOutbox([...loadOutbox(store), item], store);
  return item;
}

export const SYNC_TAG = 'afrolink-flush';

interface SyncManagerLike {
  register(tag: string): Promise<void>;
}

type SyncCapableRegistration = ServiceWorkerRegistration & { sync?: SyncManagerLike };

export function requestBackgroundSync(): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  navigator.serviceWorker.ready
    .then((reg) => (reg as SyncCapableRegistration).sync?.register(SYNC_TAG))
    .catch(() => undefined);
}

export async function flushOutbox(
  send: (item: OutboxItem) => Promise<unknown>,
  store: Storage | undefined = storage(),
): Promise<number> {
  let sent = 0;
  for (const item of loadOutbox(store)) {
    saveOutbox(loadOutbox(store).filter((i) => i.id !== item.id), store);
    try {
      await send(item);
      sent += 1;
    } catch {
      saveOutbox([...loadOutbox(store), item], store);
    }
  }
  return sent;
}

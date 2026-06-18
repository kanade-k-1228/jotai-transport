import type { Store } from '@jotai-sync/schema';
import { atom, type WritableAtom } from 'jotai';

type SyncedAtom<K extends keyof Store> = WritableAtom<
  Store[K] | Promise<Store[K]>,
  [Store[K] | ((prev: Store[K]) => Store[K])],
  void
>;

export class Transport {
  private ws: WebSocket | null = null;
  private cache = new Map<string, unknown>();
  private listeners = new Map<string, Set<(value: unknown) => void>>();

  constructor(private readonly url: string) {
    this.connect();
  }

  atom<K extends keyof Store>(key: K): SyncedAtom<K> {
    const base = atom<Store[K] | Promise<Store[K]>>(this.whenReady(key));
    base.onMount = (setSelf) => this.subscribe(key, (value) => setSelf(value as Store[K]));
    return atom(
      (get) => get(base),
      (get, set, update: Store[K] | ((prev: Store[K]) => Store[K])) => {
        const next =
          typeof update === 'function'
            ? (update as (prev: Store[K]) => Store[K])(get(base) as Store[K])
            : update;
        set(base, next);
        this.send(key, next);
      },
    );
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      for (const key in data) {
        this.cache.set(key, data[key]);
        this.listeners.get(key)?.forEach((fn) => {
          fn(data[key]);
        });
      }
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 1000);
    };
    ws.onerror = () => ws.close();
  }

  private subscribe(key: string, fn: (value: unknown) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, set);
    set.add(fn);
    if (this.cache.has(key)) fn(this.cache.get(key));
    return () => {
      set.delete(fn);
    };
  }

  private whenReady<K extends keyof Store>(key: K): Store[K] | Promise<Store[K]> {
    if (this.cache.has(key)) return this.cache.get(key) as Store[K];
    return new Promise<Store[K]>((resolve) => {
      const off = this.subscribe(key, (value) => {
        off();
        resolve(value as Store[K]);
      });
    });
  }

  private send<K extends keyof Store>(key: K, value: Store[K]) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ [key]: value }));
    }
  }
}

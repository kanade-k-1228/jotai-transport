import { atom, type WritableAtom } from 'jotai';

export type StoreKey<S extends object> = Extract<keyof S, string>;

export type SyncedAtom<S extends object, K extends StoreKey<S>> = WritableAtom<
  S[K] | Promise<S[K]>,
  [S[K] | ((prev: S[K]) => S[K])],
  void
>;

export interface TransportOptions {
  reconnectDelayMs?: number;
  webSocket?: typeof WebSocket;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class Transport<S extends object> {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private flushQueued = false;
  private cache = new Map<string, unknown>();
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  private pending: Partial<Record<StoreKey<S>, S[StoreKey<S>]>> = {};
  private readonly reconnectDelayMs: number;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(
    private readonly url: string | URL,
    options: TransportOptions = {},
  ) {
    const WebSocketImpl = options.webSocket ?? globalThis.WebSocket;
    if (!WebSocketImpl) {
      throw new Error('WebSocket is not available. Pass options.webSocket or run in a browser.');
    }
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.connect();
  }

  atom<K extends StoreKey<S>>(key: K): SyncedAtom<S, K> {
    const base = atom<S[K] | Promise<S[K]>>(this.whenReady(key));
    base.onMount = (setSelf) => this.subscribe(key, (value) => setSelf(value as S[K]));
    return atom(
      (get) => get(base),
      (get, set, update: S[K] | ((prev: S[K]) => S[K])) => {
        const next =
          typeof update === 'function'
            ? (update as (prev: S[K]) => S[K])(get(base) as S[K])
            : update;
        set(base, next);
        this.send(key, next);
      },
    );
  }

  close() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  private connect() {
    if (!this.shouldReconnect) return;

    const ws = new this.WebSocketImpl(this.url.toString());
    this.ws = ws;
    ws.onopen = () => this.flushPending();
    ws.onmessage = (ev) => {
      const data = this.parseMessage(ev.data);
      if (!data) return;

      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key, value);
        this.listeners.get(key)?.forEach((fn) => {
          fn(value);
        });
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.shouldReconnect) setTimeout(() => this.connect(), this.reconnectDelayMs);
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

  private whenReady<K extends StoreKey<S>>(key: K): S[K] | Promise<S[K]> {
    if (this.cache.has(key)) return this.cache.get(key) as S[K];
    return new Promise<S[K]>((resolve) => {
      const off = this.subscribe(key, (value) => {
        off();
        resolve(value as S[K]);
      });
    });
  }

  private send<K extends StoreKey<S>>(key: K, value: S[K]) {
    this.pending[key] = value;
    this.queueFlush();
  }

  private queueFlush() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flushPending());
  }

  private flushPending() {
    this.flushQueued = false;
    const payload = this.pending;
    this.pending = {};

    if (Object.keys(payload).length === 0) return;

    if (this.ws?.readyState !== this.WebSocketImpl.OPEN) {
      this.pending = { ...payload, ...this.pending };
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private parseMessage(data: unknown): Record<string, unknown> | null {
    if (typeof data !== 'string') return null;

    try {
      const parsed: unknown = JSON.parse(data);
      return isObjectRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export const createTransportClient = <S extends object>(
  url: string | URL,
  options?: TransportOptions,
): Transport<S> => new Transport<S>(url, options);

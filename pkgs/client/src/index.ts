import { type Atom, atom, type WritableAtom } from 'jotai';

export type StoreKey<S extends object> = Extract<keyof S, string>;

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type SyncedAtom<S extends object, K extends StoreKey<S>> = WritableAtom<
  S[K] | Promise<S[K]>,
  [S[K] | ((prev: S[K]) => S[K])],
  void
>;

export interface TransportOptions {
  url: string | URL;
  webSocket?: typeof WebSocket;
  reconnectDelayMs?: number;
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
  private dirty = new Set<string>();
  private dispatchQueued = false;
  private status: ConnectionStatus = 'connecting';
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private readonly options: TransportOptions) {
    if (!(options.webSocket ?? globalThis.WebSocket)) {
      throw new Error('WebSocket is not available. Pass options.webSocket or run in a browser.');
    }
    this.connect();
  }

  atom<K extends StoreKey<S>>(key: K): SyncedAtom<S, K> {
    const base = atom<S[K] | Promise<S[K]>>(this.whenReady(key));
    base.onMount = (setSelf) => this.subscribe(key, setSelf as (value: unknown) => void);
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

  statusAtom(): Atom<ConnectionStatus> {
    const base = atom(this.status);
    base.onMount = (setSelf) => this.subscribeStatus((status) => setSelf(status));
    return atom((get) => get(base));
  }

  close() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  private connect() {
    if (!this.shouldReconnect) return;

    this.setStatus('connecting');
    const WebSocketImpl = this.options.webSocket ?? globalThis.WebSocket;
    const ws = new WebSocketImpl(this.options.url.toString());
    this.ws = ws;
    ws.onopen = () => {
      this.setStatus('open');
      this.flushPending();
    };
    ws.onmessage = (ev) => {
      const data = this.parseMessage(ev.data);
      if (!data) return;
      for (const key in data) {
        this.cache.set(key, data[key]);
        this.dirty.add(key);
      }
      this.queueDispatch();
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setStatus('closed');
      }
      if (this.shouldReconnect)
        setTimeout(() => this.connect(), this.options.reconnectDelayMs ?? 1000);
    };
    ws.onerror = () => ws.close();
  }

  private subscribeStatus(fn: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  private queueDispatch() {
    if (this.dispatchQueued) return;
    this.dispatchQueued = true;
    queueMicrotask(() => this.flushDispatch());
  }

  private flushDispatch() {
    this.dispatchQueued = false;
    if (this.dirty.size === 0) return;
    const dirty = this.dirty;
    this.dirty = new Set();
    for (const key of dirty) {
      const value = this.cache.get(key);
      const fns = this.listeners.get(key);
      if (fns) for (const fn of fns) fn(value);
    }
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

    const WebSocketImpl = this.options.webSocket ?? globalThis.WebSocket;
    if (this.ws?.readyState !== WebSocketImpl.OPEN) {
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

export const createTransport = <S extends object>(options: TransportOptions): Transport<S> =>
  new Transport<S>(options);

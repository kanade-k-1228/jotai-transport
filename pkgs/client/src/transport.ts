import { type Atom, atom, type WritableAtom } from 'jotai/vanilla';

import { type Codec, type Frame, jsonCodec } from './codec.js';

export type Status = 'connecting' | 'connected' | 'disconnected';

export type SyncedAtom<T> = WritableAtom<T | Promise<T>, [T | ((prev: T) => T)], void>;

export interface TransportOptions {
  codec: Codec;
  reconnectIntervalMs: number;
}

const DEFAULT: TransportOptions = {
  codec: jsonCodec,
  reconnectIntervalMs: 1000,
};

type SendableFrame = Parameters<WebSocket['send']>[0];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class Transport {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private flushQueued = false;
  private cache = new Map<string, unknown>();
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  private pending: Record<string, unknown> = {};
  private dirty = new Set<string>();
  private dispatchQueued = false;
  private status: Status = 'connecting';
  private statusListeners = new Set<(status: Status) => void>();
  private readonly url: string;
  private readonly options: TransportOptions;
  private warnedUndecodable = false;

  constructor(url: string | URL, opts: Partial<TransportOptions> = {}) {
    this.url = url.toString();
    this.options = {
      codec: opts.codec ?? DEFAULT.codec,
      reconnectIntervalMs: opts.reconnectIntervalMs ?? DEFAULT.reconnectIntervalMs,
    };
    this.connect();
  }

  atom<T>(key: string): SyncedAtom<T> {
    const base = atom<T | Promise<T>>(this.whenReady<T>(key));
    base.onMount = (setSelf) => this.subscribe(key, setSelf as (value: unknown) => void);
    return atom(
      (get) => get(base),
      (get, set, update: T | ((prev: T) => T)) => {
        const next =
          typeof update === 'function' ? (update as (prev: T) => T)(get(base) as T) : update;
        set(base, next);
        this.send(key, next);
      },
    );
  }

  statusAtom(): Atom<Status> {
    const base = atom(this.status);
    base.onMount = (setSelf) => this.subscribeStatus((status) => setSelf(status));
    return atom((get) => get(base));
  }

  close() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  private connect() {
    if (!this.shouldReconnect) return;

    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.setStatus('connected');
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
        this.setStatus('disconnected');
      }
      if (this.shouldReconnect) setTimeout(() => this.connect(), this.options.reconnectIntervalMs);
    };
    ws.onerror = () => ws.close();
  }

  private subscribeStatus(fn: (status: Status) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private setStatus(status: Status) {
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

  private whenReady<T>(key: string): T | Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    return new Promise<T>((resolve) => {
      const off = this.subscribe(key, (value) => {
        off();
        resolve(value as T);
      });
    });
  }

  private send(key: string, value: unknown) {
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

    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.pending = { ...payload, ...this.pending };
      return;
    }

    this.ws.send(this.options.codec.encode(payload) as SendableFrame);
  }

  private parseMessage(data: unknown): Record<string, unknown> | null {
    try {
      const parsed = this.options.codec.decode(data as Frame);
      if (isObjectRecord(parsed)) return parsed;
    } catch {}
    this.warnUndecodable();
    return null;
  }

  private warnUndecodable() {
    if (this.warnedUndecodable) return;
    this.warnedUndecodable = true;
    console.warn(
      '[jotai-transport] ignored a frame the codec could not decode. ' +
        "If nothing ever syncs, check that the server's format matches the client's.",
    );
  }
}

export const createTransport = (
  url: string | URL,
  opts: Partial<TransportOptions> = {},
): Transport => new Transport(url, opts);

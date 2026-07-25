import { type Atom, atom } from 'jotai/vanilla';

import type { Status, SyncedAtom } from './transport.js';

export class MockTransport {
  private readonly atoms = new Map<string, SyncedAtom<unknown>>();
  private readonly initial: Record<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.initial = initial;
  }

  atom<T>(key: string): SyncedAtom<T> {
    const cached = this.atoms.get(key);
    if (cached) return cached as SyncedAtom<T>;

    const seed: T | Promise<T> =
      key in this.initial ? (this.initial[key] as T) : new Promise<T>(() => {});
    const base = atom<T | Promise<T>>(seed);
    const synced = atom(
      (get) => get(base),
      (get, set, update: T | ((prev: T) => T)) => {
        const next =
          typeof update === 'function' ? (update as (prev: T) => T)(get(base) as T) : update;
        set(base, next);
      },
    );
    this.atoms.set(key, synced as SyncedAtom<unknown>);
    return synced;
  }

  statusAtom(): Atom<Status> {
    return atom<Status>('connected');
  }

  close(): void {}
}

export const createMockTransport = (initial?: Record<string, unknown>): MockTransport =>
  new MockTransport(initial);

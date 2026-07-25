import { createStore } from 'jotai/vanilla';
import { describe, expect, test } from 'vitest';

import { createMockTransport } from './mock';

describe('MockTransport.atom', () => {
  test('suspends until a value arrives, then reads it', async () => {
    const store = createStore();
    const a = createMockTransport().atom<number>('k');
    let resolved = false;
    void Promise.resolve(store.get(a)).then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false); // no initial value → still pending
    store.set(a, 42);
    expect(await store.get(a)).toBe(42); // readable once it arrives
  });

  test('reads immediately with an initial value, and writes are reflected as-is', async () => {
    const store = createStore();
    const a = createMockTransport({ k: 1 }).atom<number>('k');
    expect(await store.get(a)).toBe(1);
    store.set(a, 2);
    expect(await store.get(a)).toBe(2);
  });

  test('returns the same atom for the same key', () => {
    const t = createMockTransport();
    expect(t.atom('k')).toBe(t.atom('k'));
  });
});

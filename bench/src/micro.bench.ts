import { createStore } from 'jotai';
import { createTransport } from 'jotai-transport';
import { bench, describe } from 'vitest';
import { FakeWebSocket } from './fake-ws.ts';
import { makeInit, type Store } from './store.ts';

const asWebSocket = FakeWebSocket as unknown as typeof WebSocket;
const KEYS = 8;
const init = makeInit(KEYS);
const names = Object.keys(init);

function harness(opts: { mount?: number; seed?: boolean } = {}) {
  const { mount = KEYS, seed = true } = opts;
  FakeWebSocket.reset();
  const transport = createTransport<Store>({ url: 'ws://bench', webSocket: asWebSocket });
  const ws = FakeWebSocket.last();
  ws.open();
  const store = createStore();
  for (let i = 0; i < mount; i++) {
    store.sub(transport.atom(names[i]), () => {});
  }
  if (seed) ws.emit(init);
  return { transport, ws, store };
}

// Transport は常にコアレッシングするため、emit ごとに microtask を回して flush させ、
// 1 メッセージ受信→反映の実コストを測る。
describe('receive: single-key dispatch', () => {
  const { ws } = harness();
  const frames = Array.from({ length: 1024 }, (_, i) => JSON.stringify({ k0: i }));
  let i = 0;
  bench('emit {k0} (distinct values)', async () => {
    ws.emitRaw(frames[i++ & 1023]);
    await Promise.resolve();
  });
});

describe('receive: 8-key dispatch', () => {
  const { ws } = harness();
  const frames = Array.from({ length: 1024 }, (_, i) => {
    const msg: Record<string, number> = {};
    for (const k of names) msg[k] = i;
    return JSON.stringify(msg);
  });
  let i = 0;
  bench('emit {k0..k7} (distinct values)', async () => {
    ws.emitRaw(frames[i++ & 1023]);
    await Promise.resolve();
  });
});

describe('receive: duplicate value', () => {
  const { ws } = harness();
  const dup = JSON.stringify({ k0: 42 });
  bench('emit {k0:42} (same value repeated)', async () => {
    ws.emitRaw(dup);
    await Promise.resolve();
  });
});

describe('send: atom write', () => {
  const { transport, store } = harness();
  const a = transport.atom('k0');
  store.sub(a, () => {});
  let n = 0;
  bench('store.set(atom, n)', () => {
    store.set(a, n++);
  });
});

describe('create: atom() with warm cache', () => {
  const { transport } = harness({ mount: 0, seed: true });
  bench('transport.atom() (cache hit)', () => {
    transport.atom('k0');
  });
});

describe('create: atom() with cold cache', () => {
  const { transport } = harness({ mount: 0, seed: false });
  let i = 0;
  bench('transport.atom() (cache miss, eager subscribe)', () => {
    transport.atom(names[i++ % KEYS]);
  });
});

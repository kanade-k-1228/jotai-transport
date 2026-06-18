import { createStore } from 'jotai';
import { type ConnectionStatus, createTransport } from 'jotai-transport';
import { describe, expect, it } from 'vitest';
import { FakeWebSocket } from './fake-ws.ts';
import { makeInit, type Store } from './store.ts';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const asWebSocket = FakeWebSocket as unknown as typeof WebSocket;

function setup(options?: { open?: boolean; reconnectDelayMs?: number }) {
  const { open = true, reconnectDelayMs } = options ?? {};
  FakeWebSocket.reset();
  const transport = createTransport<Store>({
    url: 'ws://test',
    webSocket: asWebSocket,
    reconnectDelayMs,
  });
  const ws = FakeWebSocket.last();
  if (open) ws.open();
  const store = createStore();
  return { transport, ws, store };
}

describe('Transport client behaviour (regression guard)', () => {
  it('reflects the initial full store onto mounted atoms', async () => {
    const { transport, ws, store } = setup();
    const a0 = transport.atom('k0');
    const a3 = transport.atom('k3');
    store.sub(a0, () => {});
    store.sub(a3, () => {});

    ws.emit({ k0: 5, k1: 6, k2: 7, k3: 8 });
    await tick();

    expect(store.get(a0)).toBe(5);
    expect(store.get(a3)).toBe(8);
  });

  it('applies multi-key updates atomically', async () => {
    const { transport, ws, store } = setup();
    const a0 = transport.atom('k0');
    const a1 = transport.atom('k1');
    store.sub(a0, () => {});
    store.sub(a1, () => {});

    ws.emit({ k0: 1, k1: 1, k2: 0, k3: 0 });
    await tick();
    ws.emit({ k0: 2, k1: 3 });
    await tick();

    expect(store.get(a0)).toBe(2);
    expect(store.get(a1)).toBe(3);
  });

  it('queues writes while the socket is not OPEN and flushes after open', async () => {
    const { transport, ws, store } = setup({ open: false });
    const a0 = transport.atom('k0');
    store.sub(a0, () => {});

    store.set(a0, 99);
    await tick();
    expect(ws.sent).toHaveLength(0);

    ws.open();
    await tick();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ k0: 99 });
  });

  it('coalesces same-microtask writes into a single frame', async () => {
    const { transport, ws, store } = setup();
    const a0 = transport.atom('k0');
    const a1 = transport.atom('k1');
    store.sub(a0, () => {});
    store.sub(a1, () => {});

    store.set(a0, 10);
    store.set(a1, 20);
    await tick();

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ k0: 10, k1: 20 });
  });

  it('re-receives the full store after reconnect', async () => {
    const { transport, ws, store } = setup({ reconnectDelayMs: 0 });
    const a0 = transport.atom('k0');
    store.sub(a0, () => {});

    ws.emit({ k0: 1, k1: 0, k2: 0, k3: 0 });
    await tick();
    expect(store.get(a0)).toBe(1);

    ws.close();
    await tick();
    const ws2 = FakeWebSocket.last();
    expect(ws2).not.toBe(ws);
    ws2.open();
    ws2.emit({ k0: 42, k1: 0, k2: 0, k3: 0 });
    await tick();

    expect(store.get(a0)).toBe(42);
  });

  it('keeps mounted subscribers up to date across a stream of updates', async () => {
    const { transport, ws, store } = setup();
    const a0 = transport.atom('k0');
    const seen: number[] = [];
    store.sub(a0, () => {
      const v = store.get(a0);
      if (typeof v === 'number') seen.push(v);
    });

    const init = makeInit(4);
    ws.emit(init);
    await tick();
    for (let i = 1; i <= 5; i++) {
      ws.emit({ k0: i });
      await tick();
    }

    expect(store.get(a0)).toBe(5);
    expect(seen).toContain(5);
  });
});

describe('update coalescing', () => {
  it('collapses a same-tick burst into a single latest-value dispatch', async () => {
    FakeWebSocket.reset();
    const transport = createTransport<Store>({ url: 'ws://test', webSocket: asWebSocket });
    const ws = FakeWebSocket.last();
    ws.open();
    const store = createStore();
    const a = transport.atom('k0');
    let notifications = 0;
    store.sub(a, () => {
      notifications++;
    });

    ws.emit({ k0: 1, k1: 0, k2: 0, k3: 0 });
    for (let i = 2; i <= 10; i++) ws.emitRaw(`{"k0":${i}}`);
    await tick();

    expect(store.get(a)).toBe(10);
    expect(notifications).toBe(1);
  });

  it('delivers the latest value per tick across ticks', async () => {
    FakeWebSocket.reset();
    const transport = createTransport<Store>({ url: 'ws://test', webSocket: asWebSocket });
    const ws = FakeWebSocket.last();
    ws.open();
    const store = createStore();
    const a = transport.atom('k0');
    const seen: number[] = [];
    store.sub(a, () => {
      const v = store.get(a);
      if (typeof v === 'number') seen.push(v);
    });

    ws.emit({ k0: 0, k1: 0, k2: 0, k3: 0 });
    await tick();
    ws.emitRaw('{"k0":5}');
    ws.emitRaw('{"k0":6}');
    await tick();
    ws.emitRaw('{"k0":9}');
    await tick();

    expect(store.get(a)).toBe(9);
    expect(seen).toEqual([0, 6, 9]);
  });
});

describe('statusAtom', () => {
  it('tracks the connection lifecycle', () => {
    const { transport, ws, store } = setup({ open: false });
    const s = transport.statusAtom();
    const seen: ConnectionStatus[] = [];
    store.sub(s, () => {
      seen.push(store.get(s));
    });

    expect(store.get(s)).toBe('connecting'); // 初回マウントで現在値を即配信
    ws.open();
    expect(store.get(s)).toBe('open');
    transport.close();
    expect(store.get(s)).toBe('closed');
    expect(seen).toEqual(['open', 'closed']);
  });

  it('reports reconnect transitions', async () => {
    const { transport, ws, store } = setup({ open: false, reconnectDelayMs: 0 });
    const s = transport.statusAtom();
    store.sub(s, () => {});

    expect(store.get(s)).toBe('connecting');
    ws.open();
    expect(store.get(s)).toBe('open');

    ws.close(); // onclose -> closed, reconnectDelayMs:0 で再接続予約
    expect(store.get(s)).toBe('closed');
    await tick();
    expect(store.get(s)).toBe('connecting'); // connect() で再び connecting
    FakeWebSocket.last().open();
    expect(store.get(s)).toBe('open');
  });
});

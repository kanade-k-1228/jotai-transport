import { createStore } from 'jotai/vanilla';
import { type WebSocketData, ws } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createTransport, type Status } from './transport';

const URL_ = 'ws://test.local';
const link = ws.link(URL_);
type Client = typeof link.clients extends Set<infer C> ? C : never;

const socketOf = (client: Client): WebSocket => (client as unknown as { socket: WebSocket }).socket;

const clients: Client[] = [];
const received: WebSocketData[] = [];

const server = setupServer(
  link.addEventListener('connection', ({ client }) => {
    clients.push(client);
    client.addEventListener('message', (e) => received.push(e.data));
  }),
);

beforeAll(() => server.listen());
beforeEach(() => {
  clients.length = 0;
  received.length = 0;
});
afterAll(() => server.close());

const connectedClient = async (): Promise<Client> => {
  await vi.waitFor(() => expect(clients.length).toBeGreaterThan(0));
  return clients[clients.length - 1];
};

describe('Transport.atom', () => {
  test('suspends until a value arrives, then resolves and updates as messages arrive', async () => {
    const store = createStore();
    const t = createTransport(URL_);
    const a = t.atom<number>('k');
    store.sub(a, () => {});

    const client = await connectedClient();
    client.send(JSON.stringify({ k: 1 }));
    expect(await store.get(a)).toBe(1);

    client.send(JSON.stringify({ k: 2 }));
    await expect.poll(() => store.get(a)).toBe(2);
    t.close();
  });

  test('ignores malformed and non-text frames', async () => {
    const store = createStore();
    const t = createTransport(URL_);
    const a = t.atom<number>('k');

    const client = await connectedClient();
    client.send('not json');
    client.send(JSON.stringify([1, 2]));
    client.send(new Blob(['binary']));
    client.send(new Uint8Array([1, 2, 3]));
    client.send(JSON.stringify({ k: 1 }));
    expect(await store.get(a)).toBe(1);
    t.close();
  });

  test('batches writes into a single frame', async () => {
    const store = createStore();
    const t = createTransport(URL_);
    await vi.waitFor(() => expect(store.get(t.statusAtom())).toBe('connected'));

    store.set(t.atom<number>('a'), 1);
    store.set(t.atom<number>('b'), 2);
    await vi.waitFor(() => expect(received).toEqual([JSON.stringify({ a: 1, b: 2 })]));
    t.close();
  });

  test('sends writes made before connecting once the socket opens', async () => {
    const store = createStore();
    const t = createTransport(URL_);

    store.set(t.atom<number>('k'), 1); // still CONNECTING
    await vi.waitFor(() => expect(received).toEqual([JSON.stringify({ k: 1 })]));
    t.close();
  });
});

describe('Transport.statusAtom', () => {
  test('reports connecting → connected → disconnected', async () => {
    const store = createStore();
    const t = createTransport(URL_);
    const s = t.statusAtom();
    const statuses: Status[] = [];
    store.sub(s, () => statuses.push(store.get(s)));
    expect(store.get(s)).toBe('connecting');

    const client = await connectedClient();
    await vi.waitFor(() => expect(statuses).toEqual(['connected']));
    client.close();
    await vi.waitFor(() => expect(statuses).toEqual(['connected', 'disconnected']));
    t.close();
  });
});

describe('Transport reconnection', () => {
  test('reconnects after reconnectIntervalMs on disconnect, but not after close()', async () => {
    const t = createTransport(URL_, { reconnectIntervalMs: 5 });
    const client = await connectedClient();
    expect(clients).toHaveLength(1);

    client.close(); // simulate a server-side disconnect
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    expect(socketOf(clients[1]).binaryType).toBe('arraybuffer');

    t.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(clients).toHaveLength(2);
  });
});

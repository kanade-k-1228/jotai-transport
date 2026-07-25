import { createStore } from 'jotai/vanilla';
import { type WebSocketData, ws } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { type Codec, createTransport, type Frame, jsonCodec, toBytes } from './index';


const bytesCodec: Codec = {
  encode: (payload) => new TextEncoder().encode(JSON.stringify(payload)),
  decode: (frame) => {
    const bytes = toBytes(frame);
    return bytes ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : null;
  },
};

describe('codec round-trip', () => {
  const payloads: Record<string, unknown>[] = [
    {},
    { a: 1 },
    { a: 1, b: 'x' },
    { n: null, f: 1.5, neg: -3, big: 2 ** 31 },
    { arr: [1, 2, 3], nested: { deep: true }, empty: [] },
    { 'key with spaces': '日本語 🎉' },
  ];

  describe.each([
    ['json', jsonCodec],
    ['bytes', bytesCodec],
  ])('%s', (_name, codec) => {
    test.each(payloads)('round-trips %j', (payload) => {
      expect(codec.decode(codec.encode(payload))).toEqual(JSON.parse(JSON.stringify(payload)));
    });
  });
});

const URL_ = 'ws://codec.test.local';
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

const connectedClient = async (nth = 1): Promise<Client> => {
  await vi.waitFor(() => expect(clients.length).toBeGreaterThanOrEqual(nth));
  return clients[nth - 1];
};

const decodeText = (frame: WebSocketData): unknown =>
  JSON.parse(new TextDecoder().decode(toBytes(frame as Frame) ?? new Uint8Array()));

describe('Transport with a custom codec', () => {
  test('always requests ArrayBuffer frames, with or without a codec', async () => {
    const withCodec = createTransport(URL_, { codec: bytesCodec });
    expect(socketOf(await connectedClient(1)).binaryType).toBe('arraybuffer');
    withCodec.close();

    const withDefault = createTransport(URL_);
    expect(socketOf(await connectedClient(2)).binaryType).toBe('arraybuffer');
    withDefault.close();
  });

  test('encodes outgoing writes with the codec', async () => {
    const store = createStore();
    const t = createTransport(URL_, { codec: bytesCodec });
    await vi.waitFor(() => expect(store.get(t.statusAtom())).toBe('connected'));

    store.set(t.atom<number>('a'), 1);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(ArrayBuffer.isView(received[0])).toBe(true);
    expect(decodeText(received[0])).toEqual({ a: 1 });
    t.close();
  });

  test('decodes an incoming ArrayBufferView frame', async () => {
    const store = createStore();
    const t = createTransport(URL_, { codec: bytesCodec });
    const a = t.atom<number>('k');

    const client = await connectedClient();
    client.send(new TextEncoder().encode(JSON.stringify({ k: 1 })));
    expect(await store.get(a)).toBe(1);
    t.close();
  });

  test('decodes an incoming ArrayBuffer frame', async () => {
    const store = createStore();
    const t = createTransport(URL_, { codec: bytesCodec });
    const a = t.atom<number>('k');

    const client = await connectedClient();
    const bytes = new TextEncoder().encode(JSON.stringify({ k: 2 }));
    client.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(await store.get(a)).toBe(2);
    t.close();
  });

  test('ignores frames the codec throws on', async () => {
    const store = createStore();
    const t = createTransport(URL_, { codec: bytesCodec });
    const a = t.atom<number>('k');

    const client = await connectedClient();
    client.send(new Uint8Array([0xff, 0xff])); // invalid UTF-8 → TextDecoder throws
    client.send(new TextEncoder().encode(JSON.stringify({ k: 3 })));
    expect(await store.get(a)).toBe(3);
    t.close();
  });

  test('still coalesces a microtask of writes into one encode', async () => {
    const store = createStore();
    const encode = vi.fn(bytesCodec.encode);
    const t = createTransport(URL_, { codec: { ...bytesCodec, encode } });
    await vi.waitFor(() => expect(store.get(t.statusAtom())).toBe('connected'));

    store.set(t.atom<number>('a'), 1);
    store.set(t.atom<number>('b'), 2);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decodeText(received[0])).toEqual({ a: 1, b: 2 });
    t.close();
  });
});

# jotai-transport

Jotai atoms synchronized through a WebSocket transport.

```ts
import { createTransport } from 'jotai-transport';

const transport = createTransport('ws://localhost:8137');

export const countAtom = transport.atom<number>('count');
export const commandAtom = transport.atom<string>('command');

// Read-only atom reflecting the connection state.
export const statusAtom = transport.statusAtom(); // Atom<'connecting' | 'connected' | 'disconnected'>
```

Use with `transport-server` or any WebSocket server that sends and receives patches keyed the same
way as the atoms you create, in whatever format your `codec` speaks (JSON by default).

## Options

`createTransport(url, opts?)` takes the WebSocket URL (`string | URL`) and an optional partial
options object. Anything you leave out is filled in with its default:

| option                | type     | default     | description                                            |
| --------------------- | -------- | ----------- | ------------------------------------------------------ |
| `codec`               | `Codec`  | `jsonCodec` | Messaging format. Must match the server's — see below. |
| `reconnectIntervalMs` | `number` | `1000`      | Wait before reconnecting after the socket closes (ms). |

## Connection status

`transport.statusAtom()` returns a read-only `Atom<Status>` where `Status` is
`'connecting' | 'connected' | 'disconnected'`. It updates as the socket opens, closes, and
reconnects (`'connecting'` covers both the initial connect and the wait before a reconnect
attempt).

```ts
import { useAtomValue } from 'jotai';

const status = useAtomValue(statusAtom); // 'connecting' | 'connected' | 'disconnected'
```

## Update coalescing

Incoming updates are coalesced per microtask: for each key, only the **latest** value is applied to its
atom, once. Bursts that arrive in the same tick (especially rapid updates to the same key) collapse into a
single atom write, which sharply cuts jotai recomputation and React re-renders. State sync usually only
cares about "the last value is the current value", so this works well for high-frequency streams (cursor
position, sliders, sensor values, …).

The trade-off: intermediate values within a tick are **not** delivered (latest-per-key only).

> See `bench/` (`bench/baseline.md`) in the repository for measured numbers.

## Serialization (codec)

The messaging format is pluggable. A codec is two functions:

```ts
export type Frame = string | ArrayBuffer | ArrayBufferView;

export interface Codec {
  encode(payload: Record<string, unknown>): Frame;
  decode(frame: Frame): unknown;
}
```

`encode` receives one coalesced patch (`{key: value}`) and returns the frame to send. `decode`
receives one incoming frame; returning anything that is not a plain object — **or throwing**, which is
what binary decoders do on invalid input — makes the transport ignore that frame. You never need a
`try`/`catch` of your own.

Only `jsonCodec` (the default) ships with the package, so JSON users keep the zero-dependency install.
Binary formats are a four-line adapter over the library of your choice; `toBytes` is exported to
normalize an incoming frame to a `Uint8Array`.

```ts
// MessagePack — pnpm add @msgpack/msgpack
import { decode, encode } from '@msgpack/msgpack';
import { type Codec, toBytes } from 'jotai-transport';

export const msgpackCodec: Codec = {
  encode: (payload) => encode(payload),
  decode: (frame) => decode(toBytes(frame) ?? new Uint8Array()),
};
```

```ts
// CBOR — pnpm add cbor-x
// `useRecords: false` is required: the Encoder class defaults it to true and
// then emits a cbor-x-specific record extension (tag 57343) that a plain CBOR
// server such as Rust's ciborium cannot read. cbor-x's standalone encode()
// already has it off, so either of these is safe — an Encoder is used here so
// the setting is visible rather than implied.
import { Encoder } from 'cbor-x';
import { type Codec, toBytes } from 'jotai-transport';

const cbor = new Encoder({ useRecords: false, structuredClone: false });

export const cborCodec: Codec = {
  encode: (payload) => cbor.encode(payload),
  decode: (frame) => cbor.decode(toBytes(frame) ?? new Uint8Array()),
};
```

Both adapters above are verified against this repo's Rust server: `@msgpack/msgpack` and
`rmp-serde` produce byte-identical output, and cbor-x and `ciborium` read each other's maps.

```ts
const transport = createTransport('ws://localhost:8137', { codec: msgpackCodec });
```

> **Both ends must be configured with the same format.** There is no negotiation: a mismatch shows up
> as a socket that connects and stays open while nothing ever syncs. The transport logs one
> `console.warn` the first time a frame fails to decode, and the Rust server logs decode failures to
> stderr, so check both when a connection looks healthy but no values arrive.

Codecs target **self-describing** formats (JSON, CBOR, MessagePack, BSON, …). Schema-first formats
(protobuf, FlatBuffers) do not fit this interface: it has no way to know that `"count"` is an `int64`
and `"config"` is a `Config`. That would need a typed store, not a codec.

## Mock transport

`jotai-transport/mock` exposes a drop-in replacement with the same public API (`atom` / `statusAtom` /
`close`), backed by a local jotai store — no WebSocket involved. Useful for tests, Storybook, or running
the UI without a server.

```ts
import { createMockTransport } from 'jotai-transport/mock';

const transport = createMockTransport({ count: 0 });

export const countAtom = transport.atom<number>('count'); // resolves immediately to 0
export const commandAtom = transport.atom<string>('command'); // suspends until the first write
```

`atom(key)` returns the same atom instance for a given key. Without a seed value in the initial state,
the atom suspends until the first write, mirroring the real transport's behavior before the first
message arrives. `statusAtom()` always reports `'connected'`, and `close()` is a no-op.

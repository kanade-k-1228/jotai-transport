# jotai-transport

Jotai atoms synchronized through a WebSocket transport.

```ts
import { createTransport } from 'jotai-transport';

interface Store {
  count: number;
  command: string;
}

const transport = createTransport<Store>({ url: 'ws://localhost:8137' });

export const countAtom = transport.atom('count');
export const commandAtom = transport.atom('command');

// Read-only atom reflecting the connection state.
export const statusAtom = transport.statusAtom(); // Atom<'connecting' | 'open' | 'closed'>
```

Use with `transport-server` or any WebSocket server that sends and receives JSON `Partial<Store>` patches.

## Options

`createTransport<Store>(options)` takes a single required options object:

| option             | type               | default                | description                                                         |
| ------------------ | ------------------ | ---------------------- | ------------------------------------------------------------------- |
| `url`              | `string \| URL`    | — (required)           | WebSocket URL to connect to.                                        |
| `webSocket`        | `typeof WebSocket` | `globalThis.WebSocket` | WebSocket implementation. Inject for tests or non-browser runtimes. |
| `reconnectDelayMs` | `number`           | `1000`                 | Delay before reconnecting after the socket closes (ms).             |

## Connection status

`transport.statusAtom()` returns a read-only `Atom<ConnectionStatus>` where `ConnectionStatus` is
`'connecting' | 'open' | 'closed'`. It updates as the socket opens, closes, and reconnects
(`'connecting'` covers both the initial connect and the wait before a reconnect attempt).

```ts
import { useAtomValue } from 'jotai';

const status = useAtomValue(statusAtom); // 'connecting' | 'open' | 'closed'
```

## Update coalescing

Incoming updates are coalesced per microtask: for each key, only the **latest** value is applied to its
atom, once. Bursts that arrive in the same tick (especially rapid updates to the same key) collapse into a
single atom write, which sharply cuts jotai recomputation and React re-renders. State sync usually only
cares about "the last value is the current value", so this works well for high-frequency streams (cursor
position, sliders, sensor values, …).

The trade-off: intermediate values within a tick are **not** delivered (latest-per-key only).

> See `bench/` (`bench/baseline.md`) in the repository for measured numbers.

# jotai-transport-client

Jotai atoms synchronized through a WebSocket transport.

```ts
import { createTransport } from 'jotai-transport-client';

interface Store {
  count: number;
  command: string;
}

const transport = createTransport<Store>('ws://localhost:8137');

export const countAtom = transport.atom('count');
export const commandAtom = transport.atom('command');
```

Use with `jotai-transport-server` or any WebSocket server that sends and receives JSON `Partial<Store>` patches.

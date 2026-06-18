# transport-server

WebSocket server for synchronizing an object store with `jotai-transport`.

```ts
import { createTransportServer } from 'transport-server';
import { z } from 'zod';

interface Store {
  count: number;
  command: string;
}

const init: Store = {
  count: 0,
  command: '',
};

const schema = z.object({
  count: z.number(),
  command: z.string(),
});

createTransportServer(init, schema, { port: 8137 });
```

The schema only needs a Zod-like `.partial().safeParse()` interface, so Zod is supported without being a runtime dependency of this package.

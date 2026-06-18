import { createTransportServer } from 'transport-server';
import type { Store } from '../store.ts';
import { init } from './store.ts';
import { storeSchema } from './store.zod.ts';

const PORT = Number(process.env.PORT ?? 8137);

const wss = createTransportServer<Store>(init, storeSchema, { port: PORT });

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress ?? 'unknown';
  console.log(`[connect] ${addr} (clients: ${wss.clients.size})`);
  ws.on('close', () =>
    console.log(`[disconnect] ${addr} (clients: ${wss.clients.size})`),
  );
});

wss.on('listening', () =>
  console.log(`jotai-transport server listening on ws://localhost:${PORT}`),
);
wss.on('error', (err) => {
  console.error('server error:', err);
  process.exit(1);
});

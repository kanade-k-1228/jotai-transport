import { init, type Store, storeSchema } from '@jotai-sync/schema';
import { server } from './server.ts';

const PORT = Number(process.env.PORT ?? 8137);

const wss = server<Store>(init, storeSchema, { port: PORT });

wss.on('listening', () => console.log(`jotai-sync server listening on ws://localhost:${PORT}`));
wss.on('error', (err) => {
  console.error('server error:', err);
  process.exit(1);
});

import { type ServerOptions, type WebSocket, WebSocketServer } from 'ws';
import type { ZodType } from 'zod';

export const server = <S extends object>(
  init: S,
  schema: ZodType<S> & { partial: () => ZodType<Partial<S>> },
  options?: ServerOptions,
): WebSocketServer => {
  const partial = schema.partial();
  const store: S = { ...init };
  const clients = new Set<WebSocket>();

  const sendTo = (ws: WebSocket, msg: Partial<S>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const wss = new WebSocketServer(options);

  wss.on('connection', (ws) => {
    clients.add(ws);
    sendTo(ws, store);

    ws.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = partial.safeParse(json);
      if (!parsed.success) return;

      Object.assign(store, parsed.data);
      for (const client of clients) sendTo(client, parsed.data);
    });

    ws.on('close', () => clients.delete(ws));
  });

  return wss;
};

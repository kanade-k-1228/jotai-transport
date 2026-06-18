import { type ServerOptions, WebSocket, WebSocketServer } from 'ws';

export type SafeParseResult<T> = { success: true; data: T } | { success: false };

export interface PartialSchema<S extends object> {
  safeParse(value: unknown): SafeParseResult<Partial<S>>;
}

export interface TransportSchema<S extends object> {
  partial(): PartialSchema<S>;
}

export const createTransportServer = <S extends object>(
  init: S,
  schema: TransportSchema<S>,
  options?: ServerOptions,
): WebSocketServer => {
  const partial = schema.partial();
  const store: S = { ...init };
  const clients = new Set<WebSocket>();

  const sendTo = (ws: WebSocket, msg: Partial<S>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

export { createTransportServer as server };

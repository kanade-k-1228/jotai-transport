import { type Atom, createStore } from 'jotai';
import { createTransport } from 'jotai-transport';
import { createTransportServer } from 'transport-server';
import { makeInit, makeSchema, type Store } from './store.ts';

const argInt = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return def;
};

const CLIENTS = argInt('clients', 50);
const UPDATES = argInt('updates', 2000);
const KEYS = argInt('keys', 8);
const PORT = argInt('port', 8231);

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      'global WebSocket is required (Node >= 22). Update Node or inject options.webSocket.',
    );
  }

  const init = makeInit(KEYS);
  const schema = makeSchema(init);
  const wss = createTransportServer<Store>(init, schema, { port: PORT });
  await new Promise<void>((resolve, reject) => {
    wss.on('listening', () => resolve());
    wss.on('error', reject);
  });
  const url = `ws://localhost:${PORT}`;

  const sendTimes = new Float64Array(UPDATES + 1);
  const latencies: number[] = [];
  let received = 0;

  type Client = { transport: ReturnType<typeof createTransport<Store>>; finished: boolean };
  const clients: Client[] = [];
  let finishedCount = 0;
  let resolveAllDone!: () => void;
  const allDone = new Promise<void>((r) => {
    resolveAllDone = r;
  });

  for (let c = 0; c < CLIENTS; c++) {
    // 実ソケットでは各メッセージが別 IO ターンで届くため、コアレッシングでも 1 件ごとに flush される。
    const transport = createTransport<Store>({ url });
    const store = createStore();
    const a = transport.atom('k0') as Atom<number | Promise<number>>;
    const client: Client = { transport, finished: false };
    clients.push(client);
    store.sub(a, () => {
      const v = store.get(a);
      if (typeof v !== 'number') return;
      received++;
      if (v >= 1 && v <= UPDATES) {
        const t = sendTimes[v];
        if (t > 0) latencies.push(performance.now() - t);
      }
      if (v === UPDATES && !client.finished) {
        client.finished = true;
        finishedCount++;
        if (finishedCount === CLIENTS) resolveAllDone();
      }
    });
  }

  await delay(300);

  if (typeof global.gc === 'function') global.gc();
  const memBaseline = process.memoryUsage().heapUsed;

  const sender = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    sender.onopen = () => resolve();
    sender.onerror = () => reject(new Error('sender failed to connect'));
  });

  // 常時コアレッシングのため、1 件ずつ間隔を空けて流す（同一ティックに固まると畳まれて中間値が落ちる）。
  const start = performance.now();
  for (let i = 1; i <= UPDATES; i++) {
    sendTimes[i] = performance.now();
    sender.send(JSON.stringify({ k0: i }));
    await delay(0);
  }

  const timeout = delay(10_000).then(() => 'timeout' as const);
  const result = await Promise.race([allDone.then(() => 'done' as const), timeout]);
  const elapsedMs = performance.now() - start;

  if (typeof global.gc === 'function') global.gc();
  const memAfter = process.memoryUsage().heapUsed;

  latencies.sort((x, y) => x - y);
  const expected = CLIENTS * UPDATES;
  const throughput = (received / elapsedMs) * 1000;

  console.log('--- jotai-transport E2E load ---');
  console.log(`clients=${CLIENTS} updates=${UPDATES} keys=${KEYS} port=${PORT}`);
  console.log(`completion: ${result} (${finishedCount}/${CLIENTS} clients reached final value)`);
  console.log(`messages received: ${received} / expected ${expected}`);
  console.log(`elapsed: ${elapsedMs.toFixed(1)} ms`);
  console.log(`ingest throughput: ${throughput.toFixed(0)} msg/s (across all clients)`);
  console.log('fan-out latency under load (ms):');
  console.log(
    `  p50=${percentile(latencies, 50).toFixed(3)} ` +
      `p90=${percentile(latencies, 90).toFixed(3)} ` +
      `p99=${percentile(latencies, 99).toFixed(3)} ` +
      `max=${(latencies.at(-1) ?? Number.NaN).toFixed(3)}`,
  );
  console.log('client heap:');
  console.log(
    `  baseline (after connect/mount)=${mb(memBaseline)}  after run=${mb(memAfter)}  ` +
      `per-client≈${mb(memBaseline / CLIENTS)}`,
  );
  if (typeof global.gc !== 'function') {
    console.log('  (run with `node --expose-gc` for stable heap numbers)');
  }

  sender.close();
  for (const client of clients) client.transport.close();
  wss.close();
  await delay(50);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

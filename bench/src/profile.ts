import { createStore } from 'jotai';
import { createTransport } from 'jotai-transport';
import { FakeWebSocket } from './fake-ws.ts';
import { makeInit, type Store } from './store.ts';

/**
 * 受信ホットパスの CPU プロファイル採取用エントリ。
 *
 *   node --cpu-prof --cpu-prof-dir=profiles --import tsx src/profile.ts
 *
 * Transport は常にコアレッシング（受信を microtask 単位でまとめ最新値だけ配信）するため、
 * 1 メッセージ受信ごとに microtask を回して flush させ、parseMessage → キャッシュ/dirty 更新 →
 * coalesce flush → jotai 書き込みまでを 1 件ずつ計測する。反復回数は ITER で調整（既定 100 万）。
 */

const ITER = Number(process.env.ITER ?? 1_000_000);
const KEYS = 8;
const asWebSocket = FakeWebSocket as unknown as typeof WebSocket;

const init = makeInit(KEYS);
const names = Object.keys(init);

FakeWebSocket.reset();
const transport = createTransport<Store>({ url: 'ws://profile', webSocket: asWebSocket });
const ws = FakeWebSocket.last();
ws.open();
const store = createStore();
for (const k of names) store.sub(transport.atom(k), () => {});
ws.emit(init);

// 2 キー更新を 256 種の生フレームで使い回し、直列化コストを計測から外す。
const frames = Array.from({ length: 256 }, (_, i) => JSON.stringify({ k0: i, k1: i }));

const t0 = performance.now();
for (let i = 0; i < ITER; i++) {
  ws.emitRaw(frames[i & 255]);
  await Promise.resolve(); // queueDispatch の microtask flush を 1 件ごとに走らせる
}
const elapsed = performance.now() - t0;

console.log(
  `profiled ${ITER} dispatches in ${elapsed.toFixed(0)} ms ` +
    `(${((ITER / elapsed) * 1000).toFixed(0)} dispatch/s)`,
);

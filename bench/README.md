# jotai-transport-bench

`jotai-transport`（クライアント側）の性能を計測するためのプロファイル環境。
マイクロベンチ（vitest bench）・E2E 負荷ハーネス・Node CPU プロファイルの三本立て。

> 計測対象はビルド済みの `jotai-transport`（`dist`）。コードを編集したら必ず
> `pnpm run build:packages`（リポジトリ root）で再ビルドしてから計測する。

## セットアップ

```sh
pnpm install
pnpm run build:packages   # repo root。bench は dist を参照する
```

## コマンド

```sh
# マイクロベンチ（受信ディスパッチ / 送信 / atom 生成）
pnpm --filter jotai-transport-bench bench

# 回帰テスト（挙動の非破壊を担保）
pnpm --filter jotai-transport-bench test

# E2E 負荷（実 transport-server + 複数クライアント、遅延/スループット/ヒープ）
pnpm --filter jotai-transport-bench bench:e2e -- --clients 50 --updates 2000 --keys 8
#   ヒープを安定計測したいときは --expose-gc 付きで:
node --expose-gc --import tsx src/e2e-load.ts --clients 50 --updates 2000 --keys 8

# CPU プロファイル（受信ホットパス）。profiles/*.cpuprofile を出力
pnpm --filter jotai-transport-bench bench:profile
#   反復回数は ITER で調整: ITER=3000000 node --cpu-prof --cpu-prof-dir=profiles --import tsx src/profile.ts

# プロファイラ無しの安定スループット（before/after 比較に便利）
ITER=1000000 node --import tsx src/profile.ts
```

## ファイル構成

- `src/fake-ws.ts` — 制御可能な擬似 WebSocket。`options.webSocket` に注入し、I/O コストを排して
  クライアント CPU を隔離計測する。受信は `emit()`/`emitRaw()`、送信は `sent` で捕捉。
- `src/store.ts` — 可変キー数のベンチ用ストアと、Zod 非依存の最小スキーマ。
- `src/micro.bench.ts` — ホット関数のマイクロベンチ。
- `src/e2e-load.ts` — 実サーバ＋N クライアントの端から端まで計測。Node グローバルの `WebSocket`
  （= 実ネットワーク経路）を使う。
- `src/profile.ts` — 受信ホットパスを大量反復し CPU プロファイルを採取するエントリ。
- `src/transport.test.ts` — クライアント挙動の回帰テスト。
- `baseline.md` — 計測結果（before/after）。

## CPU プロファイルの読み方

`profiles/*.cpuprofile` を [speedscope](https://www.speedscope.app/) か Chrome DevTools の
Performance タブにドロップして開く。`.0.*.cpuprofile` がメインスレッド。self-time の上位フレームで
ホットスポットを判断する（jotai 内部 / GC / ライブラリ自身の `onmessage`・`parseMessage` など）。

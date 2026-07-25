# jotai-transport

サーバ上の単一オブジェクトストアを、複数の Jotai クライアントから WebSocket 経由で閲覧・更新するためのパッケージです。クライアント（npm）とサーバ（Rust crate）、どちらも同じ `jotai-transport` という名前です。

## 特徴

- **差分だけ同期**: 接続時に全体スナップショットを1回、以降は変化したキーだけを送受信する。
- **シリアライズ形式を差し替え可能**: 既定は JSON。サーバは feature flag で CBOR / MessagePack、クライアントは数行の codec アダプタで任意の自己記述型フォーマットに切り替えられる。`Atom` の API は形式によらず不変。
- **Suspense 対応**: まだ値が届いていないキーは snapshot に含まれず、対応する Jotai atom は値が届くまで自動的に suspend する。
- **更新のまとめ送り**: 同一 microtask 内の変更は1つの JSON にまとめて送受信され、キーごとに最新値だけが反映される（高頻度更新でも jotai の再計算・再描画を抑える）。
- **サーバ側は `Atom` トレイトだけ実装すればよい**: 現在値（`value`）と、`parse`（クライアント書き込みの検証）／`load`／`persist`（保存元の読み書き）の3フックだけの最小構成。実装しなければそれぞれ read-only・保存元なし・保存しない、という意味になる。
- **遅いクライアントに強い**: クライアントごとに送信待ちの差分を持つので、詰まったクライアントがいても他のクライアントやキーの配信に影響しない。
- **モック実装つき**: `jotai-transport/mock` はサーバ無しで同じ公開 API（`atom` / `statusAtom` / `close`）を提供し、テストや Storybook で使える。

## 使い方

クライアント側:

```ts
import { createTransport } from 'jotai-transport';

const transport = createTransport('ws://localhost:8137');

export const countAtom = transport.atom<number>('count');
export const commandAtom = transport.atom<string>('command');

// 接続状態を反映する読み取り専用 atom（'connecting' | 'connected' | 'disconnected'）
export const statusAtom = transport.statusAtom();
```

`createTransport(url, opts?)` は接続先 URL（`string | URL`）と、省略可能なオプションを受け取る。
渡さなかったものは既定値で埋められる:

- `codec`（既定 `jsonCodec`）: メッセージ形式。サーバ側の設定と一致させる必要がある（後述）。
- `reconnectIntervalMs`（既定 1000）: 再接続までの待機時間。

テストや Storybook など、サーバに繋がず動かしたい場合は `jotai-transport/mock` の `createMockTransport`
がローカルの jotai store だけで完結する差し替え用実装を提供する（`atom` / `statusAtom` / `close` の
公開 API は本物と同じ）。詳細は `pkgs/client/README.md` を参照。

サーバ側（Rust crate `jotai-transport`）:

キーごとに `Atom` トレイトを実装し、`store!` マクロで `Store`（キーは構築時に確定）を組み立てて `serve` を呼びます。`Atom` が持つのは現在値（`value`）と、値の作り方・運び方のメソッド3つ（`parse` / `load` / `persist`）。必要なものだけ override すればよく、デフォルト（何もしない）実装は「その機能を持たない」という意味になる：`parse` を実装しなければ read-only、`load` を実装しなければ起動時に読み込む保存元が無い、`persist` を実装しなければクライアントの書き込みをどこにも保存しない。

```rust
use jotai_transport::{serve, store, Atom, Value};

struct Counter {
    count: Option<i64>,
}

impl Atom for Counter {
    fn value(&self) -> Option<Value> {
        self.count.map(Value::from)
    }

    fn commit(&mut self, value: Value) {
        if let Some(c) = value.as_i64() {
            self.count = Some(c);
        }
    }

    fn parse(&self, raw: &Value) -> Option<Value> {
        raw.as_i64().map(Value::from)
    }
}

#[tokio::main]
async fn main() -> Result<(), jotai_transport::BoxError> {
    let store = store! {
        "count" => Counter { count: Some(0) },
    };
    serve(store, "0.0.0.0", 8137).await
}
```

完全な例は `example/server`（3つの bool を GPIO LED に反映）を、詳しい API は `pkgs/client/README.md` /
`pkgs/server/README.md` を参照してください。

## 構成

リポジトリルートに pnpm workspace は持たず、各ディレクトリが独立してインストール・ビルドできます。

- `pkgs/client`: Jotai atom を WebSocket に同期する npm パッケージ（npm 名 `jotai-transport`）
- `pkgs/server`: WebSocket でストアを同期する Rust crate（Cargo 名 `jotai-transport`）
- `example/client`: `jotai-transport`（npm）を使う Vite + React のサンプル（3つの LED を on/off するUI）
- `example/server`: 上記 Rust crate を使い、Raspberry Pi の GPIO LED を駆動する Rust サーバ（CLI は clap。`example/server/README.md` 参照）

## 開発

クライアントライブラリをビルドします（`example/client` は `file:` 依存でこのビルド成果物を参照します）。

```sh
( cd pkgs/client && pnpm install && pnpm build )
```

サンプルは `example/Makefile` から起動します。`make run` でサーバ（Rust）とクライアント（Vite）が
両方立ち上がり、Ctrl-C で両方止まります。サーバは `jotai-transport` crate を path 依存で
取り込むため、追加のセットアップは要りません。

```sh
make -C example run                       # サーバ + クライアント
make -C example server                    # サーバだけ（Pi 以外では mock モードでログ出力）
make -C example client                    # クライアントだけ
make -C example server CODEC=cbor         # メッセージ形式を変えて起動
```

Vite は `/ws` を `ws://localhost:8137` のサーバへプロキシします。Raspberry Pi 実機で動かす場合は
`make -C example run SERVER_HOST=<PiのIP>` のように指定します（他に `PORT` / `HOST` / `CODEC`）。

検証:

```sh
make -C example check
```

## 通信プロトコル

クライアントとサーバは WebSocket 上でフラットなオブジェクト（`Partial<Store>`）を送り合い、サーバ上の単一ストアを同期します。エンベロープも型タグもメッセージ種別も無く、両方向とも同じ1つの形だけです（スナップショットは単に最初の差分）。既定の接続先は `ws://localhost:8137` です。

- 接続時: サーバがその時点のストア全体（値が届いているキーのみ）を送信する。
- 更新時: クライアントは変更したキーだけをまとめて送信し（例: `{ "count": 2, "command": "reset" }`）、サーバは受理した内容を送信元を含む全クライアントへ差分として配信する。同じキーへの同時更新は受信順に適用され、最後の値が現在値になる。ACK・履歴・バージョン番号・競合解決用のメタデータは持たない。
- デコードできないメッセージや、トップレベルがオブジェクトでないメッセージは無視され、エラーレスポンスは返さない（サーバは stderr にログ、クライアントは初回のみ `console.warn`）。
- クライアントは切断から 1 秒後に再接続し、再接続後は通常の接続時と同じくストア全体を受け取る。

認証・認可・暗号化・永続化はこのプロトコルの範囲外。必要であれば WebSocket サーバの前段や `serve` 呼び出し側で追加する。

### シリアライズ形式

このオブジェクトをどう符号化するかは `Codec` に切り出されており、JSON 以外に差し替えられます。**ネゴシエーションは行わない**ので、両端の設定を一致させる必要があります。

サーバ（Rust）は feature flag で選びます。値の内部表現は形式によらずクレート独自の `Value` で、`Atom` の実装は形式を変えても一切変わりません。`serde` には常に依存しますが、`serde_json` は `json` feature を有効にしたときだけ依存ツリーに入ります。

```toml
jotai-transport = { version = "0.3", features = ["cbor"] }  # json（既定）/ cbor / msgpack
```

```rust
serve_with_codec(store, CborCodec, "0.0.0.0", 8137).await
```

クライアント（npm）は `encode` / `decode` の2関数だけの `Codec` を渡します。同梱するのは `jsonCodec` のみで、CBOR / MessagePack は好きなライブラリを4行で包みます（`toBytes` ヘルパを export 済み）。

```ts
import { decode, encode } from '@msgpack/msgpack';
import { type Codec, createTransport, toBytes } from 'jotai-transport';

const msgpackCodec: Codec = {
  encode: (payload) => encode(payload),
  decode: (frame) => decode(toBytes(frame) ?? new Uint8Array()),
};

const transport = createTransport('ws://localhost:8137', { codec: msgpackCodec });
```

対象は自己記述型フォーマット（JSON / CBOR / MessagePack / BSON …）です。protobuf のようなスキーマ先行の形式は、キーごとの型をこのインターフェースからは知りようがないため対象外（詳細は `pkgs/server/README.md`）。また `Value` は JSON のデータモデルなので、バイト列（CBOR major type 2 / MessagePack `bin`）は表現できません（受け取る側のブラウザに対応する型が無いため意図的にそうしています）。

## 公開

npm に公開するのはクライアントパッケージ `jotai-transport` のみです（`prepack` で自動ビルド）。詳細は `Publish.md` を参照してください。`pkgs/server` は Rust crate のため npm 公開対象外です。

```sh
( cd pkgs/client && pnpm publish --access public )
```

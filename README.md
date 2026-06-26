# jotai-transport

サーバ上の単一オブジェクトストアを、複数の Jotai クライアントから WebSocket 経由で閲覧・更新するためのパッケージです。

## 構成

リポジトリルートに pnpm workspace は持たず、各ディレクトリが独立してインストール・ビルドできます。

- `pkgs/client`: Jotai atom を WebSocket に同期する npm パッケージ（npm 名 `jotai-transport`）
- `pkgs/server`: WebSocket でストアを同期する Rust crate（Cargo 名 `jotai-transport`）。プロトコルを担い、`Atom` トレイトと `store!` マクロでストアを組み立てます
- `example/client`: `jotai-transport`（npm）を使う Vite + React のサンプル（3つの LED を on/off するUI）
- `example/server`: 上記 Rust crate を使い、Raspberry Pi の GPIO LED を駆動する Rust サーバ（CLI は clap。`example/server/README.md` 参照）

## 開発

クライアントライブラリをビルドします（`example/client` は `file:` 依存でこのビルド成果物を参照します）。

```sh
( cd pkgs/client && pnpm install && pnpm build )
```

サンプルを起動します。サーバ（Rust）とクライアント（Vite）を別々に起動します。サーバは
`transport-server` crate を path 依存で取り込むため、`cargo run` だけでビルドされます。

```sh
# サーバ（Pi 以外では自動で mock モードになり LED 状態をログ出力）
( cd example/server && cargo run )

# クライアント（別ターミナル）
( cd example/client && pnpm install && pnpm dev )
```

Vite は `/ws` を `ws://localhost:8137` のサーバへプロキシします。Raspberry Pi 実機で動かす場合は
`SERVER_HOST=<PiのIP>` を付けて `pnpm dev` を起動します。

検証:

```sh
( cd example/client && pnpm typecheck && pnpm build )
( cd example/server && cargo build )
```

## 使い方

クライアント側:

```ts
import { createTransport } from 'jotai-transport';

interface Store {
  count: number;
  command: string;
}

const transport = createTransport<Store>({ url: 'ws://localhost:8137' });

export const countAtom = transport.atom('count');
export const commandAtom = transport.atom('command');

// 接続状態を反映する読み取り専用 atom（'connecting' | 'open' | 'closed'）
export const statusAtom = transport.statusAtom();
```

`createTransport` は必須の options オブジェクトを 1 つ受け取る。主なオプション:

- `url`（必須）: 接続先の WebSocket URL。
- `webSocket`: WebSocket 実装の注入（既定 `globalThis.WebSocket`）。テストや非ブラウザ環境向け。
- `reconnectDelayMs`（既定 1000）: 再接続までの待機時間。

受信更新は microtask 単位でまとめられ、キーごとに最新値だけが反映される（高頻度更新で jotai 再計算・
再描画を削減。同一ティック内の中間値は反映されない）。

サーバ側（Rust crate `transport-server`）:

キーごとに `Atom` トレイト（値の `get` / `set`）を実装し、`store!` マクロで `Store`（キーは構築時に確定）を組み立てて `serve` を呼びます。受信メッセージは各キーの `set` に渡され、反映後のスナップショットがブロードキャストされます。

```rust
use serde_json::Value;
use jotai_transport::{serve, store, Atom, ServerOptions};

struct Counter {
    count: i64,
}

impl Atom for Counter {
    fn get(&self) -> Value {
        Value::from(self.count)
    }

    fn set(&mut self, value: Value) {
        if let Some(c) = value.as_i64() {
            self.count = c;
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), jotai_transport::BoxError> {
    let store = store! {
        "count" => Counter { count: 0 },
    };
    serve(store, ServerOptions::default()).await
}
```

完全な例は `example/server`（3つの bool を GPIO LED に反映）を参照してください。

## 通信プロトコル

クライアントとサーバは WebSocket 上で JSON オブジェクトを送り合い、サーバ上の単一ストアを同期します。既定の接続先は `ws://localhost:8137` です。ブラウザクライアントは実行中ページのホスト名を使い、`ws://<hostname>:8137` に接続できます。

通信されるメッセージは UTF-8 の JSON 文字列です。内容は `Store` の一部を持つオブジェクト、つまり `Partial<Store>` です。

```json
{ "count": 1 }
```

```json
{ "command": "increment" }
```

複数キーを同時に送ることもできます。

```json
{ "count": 2, "command": "reset" }
```

### 接続時の流れ

1. クライアントが WebSocket に接続します。
2. サーバは現在のストア全体をそのクライアントに送信します。
3. クライアントは受信した各キーの値をローカルキャッシュに保存し、対応する Jotai atom を更新します。

接続直後にサーバから送られる初期状態の例:

```json
{ "count": 0, "command": "" }
```

### 更新時の流れ

1. クライアント側で `serverAtom` の値が更新されます。
2. `Transport` は更新されたキーと値を `pending` に積み、同一 microtask 内の変更をひとつの JSON オブジェクトにまとめて送信します。
3. サーバは受信 JSON を `storeSchema.partial()` 相当のスキーマで検証します。
4. 検証に成功したメッセージをサーバ上のストアへマージします。`Store` に存在しないキーは状態更新の対象外です。
5. サーバは受理した更新内容を、送信元を含む全接続クライアントへブロードキャストします。
6. 受信側クライアントは、同一 microtask 内に届いた更新をキーごとにまとめ、最新値だけを一度 Jotai atom へ反映します（中間値は反映されません）。

同じキーに対して複数クライアントから同時に更新が届いた場合は、サーバが受信した順に適用され、最後に適用された値が現在値になります。ACK、履歴、バージョン番号、競合解決用のメタデータは持ちません。

### 不正なメッセージと切断

JSON としてパースできないメッセージ、または `Store` の型に合わないメッセージは無視されます。サーバはエラーレスポンスを返しません。

クライアントは WebSocket が閉じられると 1 秒後に再接続します。再接続後は通常の接続時と同じく、サーバから現在のストア全体を受け取ります。

このプロトコルには認証、認可、暗号化、永続化は含まれていません。必要な場合は WebSocket サーバの前段や `server` 呼び出し側で追加します。

## 公開

npm に公開するのはクライアントパッケージ `jotai-transport` のみです（`prepack` で自動ビルド）。詳細は `Publish.md` を参照してください。`pkgs/server` は Rust crate のため npm 公開対象外です。

```sh
( cd pkgs/client && pnpm publish --access public )
```

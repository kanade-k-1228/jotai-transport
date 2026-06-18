# jotai-transport

サーバ上の単一オブジェクトストアを、複数の Jotai クライアントから WebSocket 経由で閲覧・更新するための実験的パッケージです。

## 構成

- `pkgs/jotai-transport-client`: Jotai atom を WebSocket に同期する公開パッケージ
- `pkgs/jotai-transport-server`: JSON patch を検証してブロードキャストする公開パッケージ
- `example`: 上記2パッケージを使う Vite + React + tsx のサンプルアプリ

## 開発

```sh
pnpm install
pnpm dev
```

`pnpm dev` は公開パッケージを先にビルドしてから、example の WebSocket サーバと Vite クライアントを起動します。別々に起動したい場合は次を使います。

```sh
pnpm server
pnpm client
```

検証:

```sh
pnpm build
pnpm check
```

## 使い方

クライアント側:

```ts
import { createTransport } from 'jotai-transport-client';

interface Store {
  count: number;
  command: string;
}

const transport = createTransport<Store>('ws://localhost:8137');

export const countAtom = transport.atom('count');
export const commandAtom = transport.atom('command');
```

サーバ側:

```ts
import { createTransportServer } from 'jotai-transport-server';
import { z } from 'zod';

interface Store {
  count: number;
  command: string;
}

const init: Store = {
  count: 0,
  command: '',
};

const storeSchema = z.object({
  count: z.number(),
  command: z.string(),
});

createTransportServer(init, storeSchema, { port: 8137 });
```

`jotai-transport-server` は Zod に直接依存せず、`.partial().safeParse()` を持つ Zod 互換のスキーマを受け取ります。

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

同じキーに対して複数クライアントから同時に更新が届いた場合は、サーバが受信した順に適用され、最後に適用された値が現在値になります。ACK、履歴、バージョン番号、競合解決用のメタデータは持ちません。

### 不正なメッセージと切断

JSON としてパースできないメッセージ、または `Store` の型に合わないメッセージは無視されます。サーバはエラーレスポンスを返しません。

クライアントは WebSocket が閉じられると 1 秒後に再接続します。再接続後は通常の接続時と同じく、サーバから現在のストア全体を受け取ります。

このプロトコルには認証、認可、暗号化、永続化は含まれていません。必要な場合は WebSocket サーバの前段や `server` 呼び出し側で追加します。

## 公開

公開前に `pnpm build` を通してください。

```sh
pnpm --filter jotai-transport-client publish --access public
pnpm --filter jotai-transport-server publish --access public
```

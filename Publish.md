# デプロイ手順

このリポジトリには公開対象のパッケージが 2 つあります。それぞれ公開先が異なります。

| パッケージ名      | ディレクトリ  | 公開先    | 公開設定 |
| ----------------- | ------------- | --------- | -------- |
| `jotai-transport` | `pkgs/client` | npm       | public   |
| `jotai-transport` | `pkgs/server` | crates.io | -        |

---

# Part 1: npm への公開

クライアントパッケージ `jotai-transport`（`pkgs/client`）を npm に公開する手順です。

## 前提

- npm アカウントを持っていること
- `package.json` に `publishConfig.access: "public"` と `prepack`（公開時に自動ビルド）が設定済みであること
- リポジトリの作業ツリーがクリーンであること（`pnpm publish` は未コミット変更があると停止します）

## 1. npm にログイン

```sh
npm login
npm whoami   # ログインユーザーを確認
```

## 2. バージョンを更新

`package.json` の `version` を上げます（セマンティックバージョニング）。

```sh
# 例: パッチ更新（git コミット/タグは作らない）
( cd pkgs/client && npm version patch --no-git-tag-version )
```

> `package.json` の `version` を直接編集しても構いません。

## 3. ビルドと検証

```sh
( cd pkgs/client && pnpm build )
npx @biomejs/biome check .   # biome（lint + format）
```

## 4. 公開内容を確認（dry-run）

実際には公開せず、tarball に含まれるファイルを確認します。

```sh
( cd pkgs/client && pnpm publish --dry-run --no-git-checks )
```

## 5. 公開

```sh
( cd pkgs/client && pnpm publish --access public )
```

- `prepack` により公開直前に `tsc` ビルドが自動実行されます。
- 2要素認証を有効にしている場合は `--otp=123456` を付けます。
- 未コミット変更がある状態で公開する場合は `--no-git-checks` を付けます（基本はコミット後の公開を推奨）。

## 6. 公開を確認

```sh
npm view jotai-transport
```

## 7. リリースをタグ付け（任意）

```sh
git tag jotai-transport@<version>
git push --tags
```

## トラブルシューティング

- `E401 Unauthorized`: 未ログイン。`npm login` を実行する。
- `EPUBLISHCONFLICT` / `cannot publish over existing version`: 同じバージョンは再公開できない。`version` を上げ直す。
- `git not clean`: 変更をコミットするか、`--no-git-checks` を付ける。

---

# Part 2: crates.io への公開（サーバー）

サーバーパッケージ `jotai-transport`（`pkgs/server`、Rust crate）を crates.io に公開する手順です。

## 前提

- crates.io アカウントを持っていること（GitHub アカウントでログイン可能）
- `Cargo.toml` に `description`・`license`（または `license-file`）・`repository` が設定済みであること（crates.io の公開要件）
- リポジトリの作業ツリーがクリーンであること（`cargo publish` は未コミット変更があると警告します）

## 1. crates.io にログイン

[crates.io](https://crates.io/) で API トークンを発行し、ログインします。

```sh
cargo login   # ブラウザで発行したトークンを貼り付け
```

## 2. バージョンを更新

`Cargo.toml` の `version` を上げます（セマンティックバージョニング）。

```sh
# 例: cargo-edit を導入済みの場合
( cd pkgs/server && cargo set-version --bump patch )
```

> `Cargo.toml` の `version` を直接編集しても構いません。

## 3. ビルドと検証

```sh
( cd pkgs/server && cargo build --release )
( cd pkgs/server && cargo test )
( cd pkgs/server && cargo fmt --check && cargo clippy )
```

## 4. 公開内容を確認（dry-run）

実際には公開せず、パッケージ化と検証のみ行います。

```sh
( cd pkgs/server && cargo publish --dry-run )
( cd pkgs/server && cargo package --list )   # 同梱ファイルを確認
```

## 5. 公開

```sh
( cd pkgs/server && cargo publish )
```

- 一度公開したバージョンは取り消せません（yank で取り下げは可能ですが再公開はできません）。
- 未コミット変更がある状態で公開する場合は `--allow-dirty` を付けます（基本はコミット後の公開を推奨）。

## 6. 公開を確認

```sh
cargo search jotai-transport
```

または [crates.io/crates/jotai-transport](https://crates.io/crates/jotai-transport) を確認します。

## 7. リリースをタグ付け（任意）

```sh
git tag jotai-transport-server@<version>
git push --tags
```

## トラブルシューティング

- `error: no token found`: 未ログイン。`cargo login` を実行する。
- `crate version is already uploaded`: 同じバージョンは再公開できない。`version` を上げ直す。
- `missing or empty metadata fields`: `Cargo.toml` に `license` / `description` などの必須メタデータを追加する。
- `dirty`: 変更をコミットするか、`--allow-dirty` を付ける。

# デプロイ手順

このリポジトリの公開パッケージを npm に公開する手順です。

| パッケージ名       | ディレクトリ            | 公開設定 |
| ------------------ | ----------------------- | -------- |
| `jotai-transport`  | `pkgs/jotai-transport`  | public   |
| `transport-server` | `pkgs/transport-server` | public   |

`example` は `private: true` のため公開対象外です。

## 前提

- npm アカウントを持っていること
- 各 `package.json` に `publishConfig.access: "public"` と `prepack`（公開時に自動ビルド）が設定済みであること
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
pnpm --filter jotai-transport exec npm version patch --no-git-tag-version
pnpm --filter transport-server exec npm version patch --no-git-tag-version
```

> 2パッケージのバージョンは独立しています。変更があった方だけ上げて構いません。
> `package.json` の `version` を直接編集しても構いません。

## 3. ビルドと検証

```sh
pnpm build
pnpm check   # typecheck + biome
```

## 4. 公開内容を確認（dry-run）

実際には公開せず、tarball に含まれるファイルを確認します。

```sh
pnpm --filter jotai-transport publish --dry-run --no-git-checks
pnpm --filter transport-server publish --dry-run --no-git-checks
```

## 5. 公開

```sh
pnpm --filter jotai-transport publish --access public
pnpm --filter transport-server publish --access public
```

- `prepack` により公開直前に `tsc` ビルドが自動実行されます。
- 2要素認証を有効にしている場合は `--otp=123456` を付けます。
- 未コミット変更がある状態で公開する場合は `--no-git-checks` を付けます（基本はコミット後の公開を推奨）。

## 6. 公開を確認

```sh
npm view jotai-transport
npm view transport-server
```

## 7. リリースをタグ付け（任意）

```sh
git tag jotai-transport@<version>
git tag transport-server@<version>
git push --tags
```

## トラブルシューティング

- `E401 Unauthorized`: 未ログイン。`npm login` を実行する。
- `EPUBLISHCONFLICT` / `cannot publish over existing version`: 同じバージョンは再公開できない。`version` を上げ直す。
- `git not clean`: 変更をコミットするか、`--no-git-checks` を付ける。

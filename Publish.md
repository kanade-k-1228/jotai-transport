# Publish

公開対象は 2 つです。

1. npm package: `pkgs/client`
2. Rust crate: `pkgs/server`

## Before Publishing

```sh
git status --short
```

- 作業ツリーをクリーンにする。
- `package.json` / `Cargo.toml` の `version` を上げる。
- crates.io に出す場合は `Cargo.toml` に `license` / `repository` などの公開用 metadata を入れる。

## Client

### Auth

```sh
npm login
npm whoami
```

### Publish

```sh
cd pkgs/client
pnpm i
pnpm build
pnpm publish --dry-run
pnpm publish --access public
```

### Check

```sh
npm view jotai-transport version
```

## crates.io

### Auth

```sh
cargo login
```

### Publish

```sh
cd pkgs/server
cargo test
cargo fmt --check
cargo clippy
cargo publish --dry-run
cargo publish
```

### Check

```sh
cargo search jotai-transport
```

## Tag

必要なら公開後にタグを打ちます。

```sh
git tag jotai-transport@<version>
git push --tags
```

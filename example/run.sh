#!/usr/bin/env bash

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- check prerequisites ---
command -v cargo >/dev/null || {
  echo "cargo not found. Install Rust: https://rustup.rs" >&2
  exit 1
}
command -v pnpm >/dev/null || {
  echo "pnpm not found. Run: corepack enable && corepack prepare pnpm@latest --activate" >&2
  exit 1
}

# --- start the server in the background ---
( cd server && cargo run ) &
server_pid=$!

# stop the server when this script exits (Ctrl-C, error, normal exit)
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

# --- start the client (predev builds pkgs/client first) ---
cd client
pnpm install
pnpm dev

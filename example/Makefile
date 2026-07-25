# Traffic-light demo: the Rust transport server plus the Vite dev client.
#
#   make               # same as `make run`
#   make run           # both; Ctrl-C stops them
#   make server        # server only
#   make client        # dev client only (expects a server on PORT)
#   make build         # production build of both
#   make check         # typecheck and build both without running anything
#   make clean         # drop build output
#
# Variables: PORT (8137), HOST (0.0.0.0), SERVER_HOST (localhost, the host the
# browser proxies to — set it to a Pi's address), CODEC (json|cbor|msgpack).

# make does not word-split SHELL, so this has to be a plain path.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:
.DEFAULT_GOAL := run

PORT ?= 8137
HOST ?= 0.0.0.0
SERVER_HOST ?= localhost
CODEC ?= json

SERVER_BIN := server/target/debug/jotai-transport-example
SERVER_ARGS := --host $(HOST) --port $(PORT) --codec $(CODEC)

# vite.config.ts reads these to point its /ws proxy at the server.
export PORT
export SERVER_HOST

.PHONY: run server client build check clean tools

# Build first and launch the binary directly rather than through `cargo run`:
# that makes $! the server itself, so the trap can actually stop it. (The
# server ignores SIGINT, so Ctrl-C alone would otherwise leave it holding PORT.)
run: tools
	( cd server && cargo build )
	$(SERVER_BIN) $(SERVER_ARGS) &
	server_pid=$$!
	trap 'kill "$$server_pid" 2>/dev/null || true' EXIT INT TERM
	( cd client && pnpm install && pnpm dev )

# .ONESHELL runs each recipe in a single shell, so every `cd` is in a subshell.
server:
	command -v cargo >/dev/null || { echo "cargo not found. Install Rust: https://rustup.rs" >&2; exit 1; }
	( cd server && cargo run -- $(SERVER_ARGS) )

# `predev` rebuilds pkgs/client first, so the demo always runs the current library.
client:
	command -v pnpm >/dev/null || { echo "pnpm not found. Run: corepack enable" >&2; exit 1; }
	( cd client && pnpm install && pnpm dev )

build: tools
	( cd client && pnpm install && pnpm build )
	( cd server && cargo build --release )

check: tools
	( cd client && pnpm install && pnpm typecheck && pnpm build )
	( cd server && cargo build )

clean:
	rm -rf client/dist
	( cd server && cargo clean )

tools:
	command -v cargo >/dev/null || { echo "cargo not found. Install Rust: https://rustup.rs" >&2; exit 1; }
	command -v pnpm >/dev/null || { echo "pnpm not found. Run: corepack enable" >&2; exit 1; }

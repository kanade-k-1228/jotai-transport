# jotai-transport (Rust server crate)

A WebSocket server crate (Cargo package `jotai-transport`) for synchronizing a
single object store with the [`jotai-transport`](../client) client (the npm
package of the same name). The crate owns the wire protocol and broadcasting; you
implement the [`Atom`] trait and assemble a [`Store`].

> This replaces the former TypeScript `transport-server` package. The protocol is
> unchanged, so the same clients work without modification.

## Layout

- `src/atom.rs` — the `Atom` trait (`get` / `set` a single value as JSON).
- `src/store.rs` — `Store`, a fixed `HashMap<String, Box<dyn Atom>>` with `get` /
  `set` plus `snapshot` / `apply` for the wire protocol, and the `store!` macro.
- `src/server.rs` — `serve` (the WebSocket server).
- `src/lib.rs` — module declarations and re-exports.

## Protocol

- On connect the server sends `Store::snapshot()` once (the JSON object of all atoms).
- Clients send partial updates as JSON text, e.g. `{"red":true}`.
- For each present key the store calls the atom's `set`, then broadcasts the new
  snapshot to every client (including the sender).
- A message that isn't a JSON object is silently ignored.

## Usage

Add it as a path (or git) dependency:

```toml
[dependencies]
jotai-transport = { path = "../../pkgs/server" }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

Implement [`Atom`] for each value, declare the [`Store`] with the [`store!`] macro
(keys are fixed at construction — there is no `insert`), and call [`serve`]:

```rust
use serde_json::Value;
use jotai_transport::{serve, store, Atom};

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
    serve(store, "0.0.0.0", 8137).await
}
```

See [`example/server`](../../example/server) for a complete server that mirrors
three booleans onto Raspberry Pi GPIO LEDs.

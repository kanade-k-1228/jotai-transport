# jotai-transport (Rust server crate)

A WebSocket server crate (Cargo package `jotai-transport`) for synchronizing a
single object store with the [`jotai-transport`](../client) client (the npm
package of the same name). The crate owns the messaging protocol and broadcasting;
you own the state.

## Features

- **Minimal `Atom` trait** — a current `value`, plus three optional hooks:
  `parse` to accept client writes, and `load` / `persist` to read and write a
  backing store (a file, hardware, ...). Implement only what you need — the
  rest defaults to "not supported": no `parse` means read-only, no `load`
  means no backing store to read at startup, no `persist` means writes stay
  in memory only.
- **Diff-based sync** — clients get a full snapshot on connect, then only the
  keys that actually changed, as `{"key": value}` messages.
- **Pluggable messaging format** — JSON by default, CBOR or MessagePack behind a
  feature flag, or your own [`Codec`] impl. The `Atom` API is unchanged either
  way; only the encoding boundary swaps.
- **Suspense-friendly** — an atom with no value yet is left out of the
  snapshot; the [client](../client) suspends on that key until one arrives.
- **Robust fan-out** — each connected client keeps its own pending diff
  instead of sharing a bounded broadcast channel, so a slow client never
  misses an update or gets silently disconnected.
- **Automatic refresh** — atoms backed by an external store (`load`) are
  re-read on a timer, so changes made outside of a client write (a config
  file edited on disk, a sensor value, ...) are picked up and broadcast on
  their own.

## Usage

Add it as a path (or git) dependency:

```toml
[dependencies]
jotai-transport = { path = "../../pkgs/server" }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

Implement [`Atom`] for each value, declare the [`Store`] with the [`store!`] macro
(keys are fixed at construction — there is no `insert`), and call [`serve`]:

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

See [`example/server`](../../example/server) for a complete server that mirrors
three booleans onto Raspberry Pi GPIO LEDs.

## Serialization

Values are the crate's own [`Value`] everywhere — in `Atom`, in `Store`, and in
the diffs the server broadcasts — regardless of the messaging format. It
implements `Serialize`/`Deserialize`, so any self-describing serde format
encodes it directly; only the encoding boundary changes.

`serde` is always a dependency; `serde_json` is pulled in only by the `json`
feature, so a CBOR- or MessagePack-only build does not carry it.

| feature   | codec           | frames | crate       |
| --------- | --------------- | ------ | ----------- |
| `json`    | `JsonCodec`     | text   | (default)   |
| `cbor`    | `CborCodec`     | binary | `ciborium`  |
| `msgpack` | `MsgpackCodec`  | binary | `rmp-serde` |

```toml
jotai-transport = { version = "0.3", features = ["cbor"] }
```

```rust
use jotai_transport::{serve_with_codec, store, CborCodec};

serve_with_codec(store, CborCodec, "0.0.0.0", 8137).await
```

`serve(store, host, port)` is unchanged and equivalent to
`serve_with_codec(store, JsonCodec, host, port)`.

> **The format is not negotiated.** The client must be configured with the same
> codec, or the connection will stay open while nothing decodes in either
> direction. The server logs the active codec at startup and logs every decode
> failure to stderr; the browser client warns once on its side.

[`Value`] is the JSON data model — `Null`, `Bool`, `Int`, `Uint`, `Float`,
`Str`, `Array`, `Object` — so **byte strings cannot be represented** (CBOR major
type 2, MessagePack `bin`); decoding one fails. That is deliberate rather than
incidental: the peer is a browser client whose values are JSON's, so nothing
there could receive one. `Int` and `Uint` compare equal across the split
(`Int(7) == Uint(7)`), which is what `Store::refresh` relies on to tell whether
a reloaded value actually changed.

Schema-first formats (protobuf, FlatBuffers) are out of scope: this protocol is
a dynamic untyped `{key: value}` map, so a protobuf codec would either be
`google.protobuf.Struct` in disguise (larger than CBOR, no type safety) or need
a per-key schema registry and a different `Atom` design. `Codec` is a public
trait, so an out-of-tree implementation is always possible.

## Protocol

Identical to the `jotai-transport` client: on connect the server sends the
current snapshot; clients send partial `{"key": value}` updates; the server
broadcasts back whatever it accepted (including to the sender) as a diff. A
message the codec cannot decode, or one that isn't a top-level object, is
logged to stderr and ignored, with no error response.

> This crate replaces the former TypeScript `transport-server` package. The
> protocol is unchanged, so the same clients work without modification.

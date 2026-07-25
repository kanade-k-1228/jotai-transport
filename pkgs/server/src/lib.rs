//! WebSocket server for synchronizing a single object store with jotai clients.
//!
//! # Value model
//!
//! Every value flowing through [`Atom`] and [`Store`] is a crate-owned [`Value`],
//! regardless of the messaging format in use. It implements `Serialize` and
//! `Deserialize`, so any self-describing serde format encodes it directly; the
//! format is swapped at the encoding boundary only, by a [`Codec`].
//!
//! [`Value`] is the JSON data model, so it deliberately has no byte-string
//! variant even though CBOR and MessagePack have one: the peer is a browser
//! client whose values are JSON's, and nothing there could receive it.

mod atom;
mod codec;
mod server;
mod store;
mod value;

pub use atom::Atom;
pub use codec::{Codec, Frame};
pub use server::{serve_with_codec, BoxError};
pub use store::Store;
pub use value::{Object, Value};

#[cfg(feature = "json")]
pub use codec::JsonCodec;
#[cfg(feature = "json")]
pub use server::serve;

#[cfg(feature = "cbor")]
pub use codec::CborCodec;
#[cfg(feature = "msgpack")]
pub use codec::MsgpackCodec;

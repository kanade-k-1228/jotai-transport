//! WebSocket server for synchronizing a single object store with `jotai-transport`.
//!
//! This crate owns the wire protocol; you own the atoms. Build a [`Store`] from
//! your own [`Atom`] implementations (the [`store!`] macro is the easy way) and
//! call [`serve`].
//!
//! Protocol (identical to the `jotai-transport` client):
//!
//!   * on connect    -> the server sends [`Store::snapshot`] once
//!   * client -> srv -> a partial `{ "key": value }` JSON text message
//!   * srv -> clients -> after merging, the new snapshot is broadcast to every
//!                       connected client (including the sender)
//!
//! A message that is not a JSON object is silently ignored, with no error response.

mod atom;
mod server;
mod store;

pub use atom::Atom;
pub use server::{serve, BoxError, ServerOptions};
pub use store::Store;

// Re-exported so downstream code can name the `Value` type used by `Atom`.
pub use serde_json;

use serde_json::Value;

/// A single synchronized value, addressed by a key in a [`Store`](crate::Store).
///
/// Implement this for your own state. The side effect of an update lives in
/// [`set`](Atom::set) — e.g. writing a hardware pin — while [`get`](Atom::get)
/// reports the current value as JSON for snapshots and broadcasts.
pub trait Atom: Send {
    /// The current value as JSON.
    fn get(&self) -> Value;

    /// Update the value from an incoming JSON value. Implementations should
    /// ignore values of an unexpected shape (e.g. a string for a boolean atom).
    fn set(&mut self, value: Value);
}

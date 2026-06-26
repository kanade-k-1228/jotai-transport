use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::atom::Atom;

/// A fixed set of [`Atom`]s addressed by string keys, serialized as a JSON object.
///
/// The keys and atoms are decided once at construction — there is no `insert`.
/// Build one with the [`store!`](crate::store) macro (or [`Store::from_atoms`]).
/// `get`/`set` then read and update existing atoms; unknown keys are ignored.
pub struct Store {
    atoms: HashMap<String, Box<dyn Atom>>,
}

impl Store {
    /// Build a store from its complete, fixed set of atoms. Prefer the
    /// [`store!`](crate::store) macro for a concise literal.
    pub fn from_atoms<I>(atoms: I) -> Self
    where
        I: IntoIterator<Item = (String, Box<dyn Atom>)>,
    {
        Store {
            atoms: atoms.into_iter().collect(),
        }
    }

    /// Current value of `key`, or `None` if no such atom is registered.
    pub fn get(&self, key: &str) -> Option<Value> {
        self.atoms.get(key).map(|atom| atom.get())
    }

    /// Update `key` if it exists; unknown keys are ignored.
    pub fn set(&mut self, key: &str, value: Value) {
        if let Some(atom) = self.atoms.get_mut(key) {
            atom.set(value);
        }
    }

    /// The full store as a JSON object string. Sent to each client on connect
    /// and used as the broadcast payload after an update.
    pub fn snapshot(&self) -> String {
        let map: Map<String, Value> = self
            .atoms
            .iter()
            .map(|(key, atom)| (key.clone(), atom.get()))
            .collect();
        Value::Object(map).to_string()
    }

    /// Apply a partial-update message (`{ "key": value, ... }`): set each present
    /// key, then return the new snapshot to broadcast. Returns `None` when the
    /// message is not a JSON object, so it is ignored.
    pub fn apply(&mut self, message: &str) -> Option<String> {
        let Ok(Value::Object(map)) = serde_json::from_str::<Value>(message) else {
            return None;
        };
        for (key, value) in map {
            self.set(&key, value);
        }
        Some(self.snapshot())
    }
}

/// Build a [`Store`] from a fixed set of `key => atom` pairs.
///
/// ```
/// use jotai_transport::serde_json::Value;
/// use jotai_transport::{store, Atom};
///
/// struct Flag(bool);
/// impl Atom for Flag {
///     fn get(&self) -> Value { Value::Bool(self.0) }
///     fn set(&mut self, v: Value) { if let Value::Bool(b) = v { self.0 = b; } }
/// }
///
/// let store = store! {
///     "power" => Flag(false),
///     "ready" => Flag(true),
/// };
/// ```
#[macro_export]
macro_rules! store {
    ($($key:expr => $atom:expr),* $(,)?) => {
        $crate::Store::from_atoms([
            $(
                (
                    ::std::string::String::from($key),
                    ::std::boxed::Box::new($atom) as ::std::boxed::Box<dyn $crate::Atom>,
                )
            ),*
        ])
    };
}

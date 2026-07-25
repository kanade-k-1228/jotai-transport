use std::collections::HashMap;

use crate::atom::Atom;
use crate::value::{Object, Value};

pub struct Store {
    atoms: HashMap<String, Box<dyn Atom>>,
}

impl Store {
    pub fn from_atoms<I>(atoms: I) -> Self
    where
        I: IntoIterator<Item = (String, Box<dyn Atom>)>,
    {
        Store {
            atoms: atoms.into_iter().collect(),
        }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.atoms.get(key)?.value()
    }

    pub fn snapshot(&self) -> Object {
        self.atoms
            .iter()
            .filter_map(|(key, atom)| atom.value().map(|v| (key.clone(), v)))
            .collect()
    }

    pub fn update(&mut self, partial: Object) -> Object {
        let mut accepted = Object::new();
        for (key, raw) in partial {
            let Some(atom) = self.atoms.get_mut(&key) else {
                continue;
            };
            let Some(value) = atom.parse(&raw) else {
                continue;
            };
            if let Err(e) = atom.persist(&value) {
                eprintln!("[store] persist failed for {key}: {e}");
            }
            atom.commit(value.clone());
            accepted.insert(key, value);
        }
        accepted
    }

    pub fn refresh(&mut self) -> Object {
        let mut changed = Object::new();
        for (key, atom) in self.atoms.iter_mut() {
            let Some(value) = atom.load() else {
                continue;
            };
            if atom.value().as_ref() != Some(&value) {
                atom.commit(value.clone());
                changed.insert(key.clone(), value);
            }
        }
        changed
    }
}

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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::BoxError;

    fn object<const N: usize>(entries: [(&str, Value); N]) -> Object {
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect()
    }

    #[derive(Default)]
    struct Cell {
        value: Option<Value>,
        external: Option<Value>,
        persisted: RefCell<Vec<Value>>,
        persist_fails: bool,
    }

    impl Cell {
        fn holding(value: Value) -> Self {
            Cell {
                value: Some(value),
                ..Cell::default()
            }
        }

        fn backed_by(value: Value, external: Value) -> Self {
            Cell {
                value: Some(value),
                external: Some(external),
                ..Cell::default()
            }
        }
    }

    impl Atom for Cell {
        fn value(&self) -> Option<Value> {
            self.value.clone()
        }

        fn commit(&mut self, value: Value) {
            self.value = Some(value);
        }

        /// Integers only, so a rejected write is reachable from a test.
        fn parse(&self, raw: &Value) -> Option<Value> {
            raw.as_i64().map(Value::Int)
        }

        fn load(&self) -> Option<Value> {
            self.external.clone()
        }

        fn persist(&self, value: &Value) -> Result<(), BoxError> {
            self.persisted.borrow_mut().push(value.clone());
            if self.persist_fails {
                return Err("backing store unavailable".into());
            }
            Ok(())
        }
    }

    /// No `parse` override, so `Atom`'s default makes it read-only.
    struct ReadOnly(Value);

    impl Atom for ReadOnly {
        fn value(&self) -> Option<Value> {
            Some(self.0.clone())
        }

        fn commit(&mut self, value: Value) {
            self.0 = value;
        }
    }

    #[test]
    fn snapshot_and_get_omit_atoms_with_no_value_yet() {
        let store = crate::store! {
            "ready" => Cell::holding(Value::Int(1)),
            "pending" => Cell::default(),
        };

        assert_eq!(store.snapshot(), object([("ready", Value::Int(1))]));
        assert_eq!(store.get("ready"), Some(Value::Int(1)));
        assert_eq!(store.get("pending"), None);
        assert_eq!(store.get("absent"), None);
    }

    #[test]
    fn update_commits_and_returns_only_accepted_keys() {
        let mut store = crate::store! { "count" => Cell::holding(Value::Int(0)) };

        let accepted = store.update(object([
            ("count", Value::Int(7)),
            ("absent", Value::Int(1)),
        ]));

        assert_eq!(accepted, object([("count", Value::Int(7))]));
        assert_eq!(store.get("count"), Some(Value::Int(7)));
    }

    #[test]
    fn update_drops_values_the_atom_will_not_parse() {
        let mut store = crate::store! { "count" => Cell::holding(Value::Int(0)) };

        let accepted = store.update(object([("count", Value::Str("seven".into()))]));

        assert!(accepted.is_empty());
        assert_eq!(store.get("count"), Some(Value::Int(0)));
    }

    #[test]
    fn a_read_only_atom_rejects_every_write() {
        let mut store = crate::store! { "version" => ReadOnly(Value::Str("1.0".into())) };

        let accepted = store.update(object([("version", Value::Str("2.0".into()))]));

        assert!(accepted.is_empty());
        assert_eq!(store.get("version"), Some(Value::Str("1.0".into())));
    }

    #[test]
    fn update_commits_even_when_persist_fails() {
        // The write is still the client's intent, and dropping it would leave
        // that client showing a value the server does not have.
        let mut store = crate::store! {
            "count" => Cell { value: Some(Value::Int(0)), persist_fails: true, ..Cell::default() }
        };

        let accepted = store.update(object([("count", Value::Int(7))]));

        assert_eq!(accepted, object([("count", Value::Int(7))]));
        assert_eq!(store.get("count"), Some(Value::Int(7)));
    }

    #[test]
    fn refresh_reports_and_commits_a_changed_backing_value() {
        let mut store = crate::store! {
            "sensor" => Cell::backed_by(Value::Int(1), Value::Int(2)),
        };

        assert_eq!(store.refresh(), object([("sensor", Value::Int(2))]));
        assert_eq!(store.get("sensor"), Some(Value::Int(2)));
        // Second pass: the backing value now matches, so nothing is broadcast.
        assert!(store.refresh().is_empty());
    }

    #[test]
    fn refresh_ignores_atoms_with_no_backing_store() {
        let mut store = crate::store! { "count" => Cell::holding(Value::Int(1)) };

        assert!(store.refresh().is_empty());
    }

    /// The change check runs on `Value`'s `PartialEq`, which compares integers
    /// across the `Int`/`Uint` split. If it did not, an atom whose backing
    /// store hands back a `Uint` would look changed on every single tick.
    #[test]
    fn refresh_treats_int_and_uint_as_the_same_value() {
        let mut store = crate::store! {
            "count" => Cell::backed_by(Value::Int(7), Value::Uint(7)),
        };

        assert!(store.refresh().is_empty());
    }
}

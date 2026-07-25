use std::collections::BTreeMap;
use std::fmt;

use serde::de::{Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};

/// A `{key: value}` map — the only shape this protocol carries.
///
/// `BTreeMap` rather than `HashMap`: keys go out in a deterministic order, so
/// the encoded bytes for a given diff are reproducible.
pub type Object = BTreeMap<String, Value>;

/// A codec-neutral value.
///
/// This is the JSON data model, which is what the browser client can hold, so
/// it round-trips through every self-describing format the crate supports.
/// Byte strings (CBOR major type 2, MessagePack `bin`) are deliberately absent
/// for the same reason: nothing on the other end could receive one.
///
/// `Float` can hold NaN and infinity, which JSON cannot: `JsonCodec` encodes
/// those as `null`, while CBOR and MessagePack keep them.
#[derive(Debug, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    /// Only for values above `i64::MAX`; everything else is `Int`.
    Uint(u64),
    Float(f64),
    Str(String),
    Array(Vec<Value>),
    Object(Object),
}

impl Value {
    /// Name of the variant, for error messages.
    pub fn kind(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "a boolean",
            Value::Int(_) | Value::Uint(_) | Value::Float(_) => "a number",
            Value::Str(_) => "a string",
            Value::Array(_) => "an array",
            Value::Object(_) => "an object",
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            Value::Uint(u) => i64::try_from(*u).ok(),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Value::Int(i) => u64::try_from(*i).ok(),
            Value::Uint(u) => Some(*u),
            _ => None,
        }
    }

    /// Any number widened to `f64`. Large integers lose precision, as they do
    /// on the JavaScript side.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(*i as f64),
            Value::Uint(u) => Some(*u as f64),
            Value::Float(f) => Some(*f),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Value::Object(o) => Some(o),
            _ => None,
        }
    }
}

/// `Int` and `Uint` compare across the split, so a value is equal to itself no
/// matter which variant it was built as. `Store::refresh` uses this to decide
/// whether a reloaded value actually changed, so getting it wrong would either
/// spam clients or drop updates.
///
/// Numbers of different *kinds* stay distinct, matching JSON: `1 != 1.0`.
impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Int(a), Value::Int(b)) => a == b,
            (Value::Uint(a), Value::Uint(b)) => a == b,
            (Value::Int(a), Value::Uint(b)) | (Value::Uint(b), Value::Int(a)) => {
                u64::try_from(*a).is_ok_and(|a| a == *b)
            }
            (Value::Float(a), Value::Float(b)) => a == b,
            (Value::Str(a), Value::Str(b)) => a == b,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => false,
        }
    }
}

impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Value::Bool(v)
    }
}

impl From<u64> for Value {
    fn from(v: u64) -> Self {
        // Keep `Int` canonical so the two integer variants don't both hold the
        // same value in ordinary use.
        match i64::try_from(v) {
            Ok(i) => Value::Int(i),
            Err(_) => Value::Uint(v),
        }
    }
}

macro_rules! from_int {
    ($($t:ty),*) => {$(
        impl From<$t> for Value {
            fn from(v: $t) -> Self {
                Value::Int(v as i64)
            }
        }
    )*};
}
from_int!(i8, i16, i32, i64, u8, u16, u32);

macro_rules! from_float {
    ($($t:ty),*) => {$(
        impl From<$t> for Value {
            fn from(v: $t) -> Self {
                Value::Float(v as f64)
            }
        }
    )*};
}
from_float!(f32, f64);

impl From<String> for Value {
    fn from(v: String) -> Self {
        Value::Str(v)
    }
}

impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Value::Str(v.to_owned())
    }
}

impl<T: Into<Value>> From<Vec<T>> for Value {
    fn from(v: Vec<T>) -> Self {
        Value::Array(v.into_iter().map(Into::into).collect())
    }
}

impl From<Object> for Value {
    fn from(v: Object) -> Self {
        Value::Object(v)
    }
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Self {
        v.map_or(Value::Null, Into::into)
    }
}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Value::Null => serializer.serialize_unit(),
            Value::Bool(b) => serializer.serialize_bool(*b),
            Value::Int(i) => serializer.serialize_i64(*i),
            Value::Uint(u) => serializer.serialize_u64(*u),
            Value::Float(f) => serializer.serialize_f64(*f),
            Value::Str(s) => serializer.serialize_str(s),
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Value::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, value) in entries {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // `deserialize_any` is why codecs must be self-describing formats.
        deserializer.deserialize_any(ValueVisitor)
    }
}

struct ValueVisitor;

impl<'de> Visitor<'de> for ValueVisitor {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON-shaped value")
    }

    fn visit_bool<E>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }

    fn visit_i64<E>(self, v: i64) -> Result<Value, E> {
        Ok(Value::Int(v))
    }

    fn visit_u64<E>(self, v: u64) -> Result<Value, E> {
        Ok(Value::from(v))
    }

    fn visit_f64<E>(self, v: f64) -> Result<Value, E> {
        Ok(Value::Float(v))
    }

    fn visit_str<E>(self, v: &str) -> Result<Value, E> {
        Ok(Value::Str(v.to_owned()))
    }

    fn visit_string<E>(self, v: String) -> Result<Value, E> {
        Ok(Value::Str(v))
    }

    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_none<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        deserializer.deserialize_any(self)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut items = Vec::with_capacity(seq.size_hint().unwrap_or(0));
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut entries = Object::new();
        while let Some((key, value)) = map.next_entry::<String, Value>()? {
            entries.insert(key, value);
        }
        Ok(Value::Object(entries))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_compare_across_the_int_uint_split() {
        assert_eq!(Value::Int(7), Value::Uint(7));
        assert_eq!(Value::Uint(7), Value::Int(7));
        assert_ne!(Value::Int(-1), Value::Uint(u64::MAX));
        assert_ne!(Value::Int(7), Value::Float(7.0));
    }

    #[test]
    fn from_u64_prefers_int() {
        assert_eq!(Value::from(7u64), Value::Int(7));
        assert_eq!(
            Value::from(i64::MAX as u64 + 1),
            Value::Uint(i64::MAX as u64 + 1)
        );
    }

    #[test]
    fn accessors_are_type_directed() {
        assert_eq!(Value::Bool(true).as_bool(), Some(true));
        assert_eq!(Value::Int(-3).as_i64(), Some(-3));
        assert_eq!(Value::Int(-3).as_u64(), None);
        assert_eq!(Value::Uint(u64::MAX).as_i64(), None);
        assert_eq!(Value::Float(1.5).as_i64(), None);
        assert_eq!(Value::Int(2).as_f64(), Some(2.0));
        assert_eq!(Value::Str("x".into()).as_str(), Some("x"));
        assert_eq!(Value::Null.as_bool(), None);
        assert!(Value::Null.is_null());
    }

    #[test]
    fn options_become_null() {
        assert_eq!(Value::from(None::<i64>), Value::Null);
        assert_eq!(Value::from(Some(1i64)), Value::Int(1));
    }
}

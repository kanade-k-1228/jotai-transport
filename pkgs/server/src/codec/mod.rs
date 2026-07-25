use crate::value::{Object, Value};
use crate::BoxError;

#[cfg(feature = "cbor")]
mod cbor;
#[cfg(feature = "json")]
mod json;
#[cfg(feature = "msgpack")]
mod msgpack;

#[cfg(feature = "cbor")]
pub use cbor::CborCodec;
#[cfg(feature = "json")]
pub use json::JsonCodec;
#[cfg(feature = "msgpack")]
pub use msgpack::MsgpackCodec;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Text(String),
    Binary(Vec<u8>),
}

pub trait Codec: Send + Sync + 'static {
    fn name(&self) -> &'static str;
    fn encode(&self, diff: &Object) -> Result<Frame, BoxError>;
    fn decode(&self, frame: &Frame) -> Result<Object, BoxError>;
}

fn into_object(value: Value) -> Result<Object, BoxError> {
    match value {
        Value::Object(map) => Ok(map),
        other => Err(format!("expected a top-level object, got {}", other.kind()).into()),
    }
}

#[cfg(any(feature = "cbor", feature = "msgpack"))]
fn expect_binary<'a>(frame: &'a Frame, name: &str) -> Result<&'a [u8], BoxError> {
    match frame {
        Frame::Binary(bytes) => Ok(bytes),
        Frame::Text(_) => Err(format!("{name} codec requires a binary frame").into()),
    }
}

#[cfg(test)]
pub(crate) mod fixture {
    use crate::value::{Object, Value};

    pub(crate) fn object<const N: usize>(entries: [(&str, Value); N]) -> Object {
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect()
    }

    /// Every value shape the store can carry, in one diff.
    pub(crate) fn diff() -> Object {
        object([
            ("null", Value::Null),
            ("bool", Value::Bool(true)),
            ("zero", Value::Int(0)),
            ("neg", Value::Int(-42)),
            ("i64_min", Value::Int(i64::MIN)),
            ("u64_big", Value::Uint(i64::MAX as u64 + 1)),
            ("float", Value::Float(1.5)),
            (
                "text",
                Value::Str("日本語 🎉 \"quoted\"\nnewline".to_owned()),
            ),
            ("empty_array", Value::Array(Vec::new())),
            (
                "array",
                Value::Array(vec![
                    Value::Int(1),
                    Value::Str("two".to_owned()),
                    Value::Bool(false),
                    Value::Null,
                    Value::Array(vec![Value::Int(3)]),
                ]),
            ),
            (
                "object",
                Value::Object(object([
                    (
                        "nested",
                        Value::Object(object([("deep", Value::Bool(true))])),
                    ),
                    ("empty", Value::Object(Object::new())),
                ])),
            ),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::fixture;
    use super::*;

    /// Every codec the current feature set enables.
    // `vec![]` can't take `#[cfg]` on its elements, hence the pushes.
    #[allow(clippy::vec_init_then_push)]
    fn codecs() -> Vec<Box<dyn Codec>> {
        let mut v: Vec<Box<dyn Codec>> = Vec::new();
        #[cfg(feature = "json")]
        v.push(Box::new(JsonCodec));
        #[cfg(feature = "cbor")]
        v.push(Box::new(CborCodec));
        #[cfg(feature = "msgpack")]
        v.push(Box::new(MsgpackCodec));
        v
    }

    #[test]
    fn round_trips_every_value_shape() {
        let diff = fixture::diff();
        for codec in codecs() {
            let frame = codec
                .encode(&diff)
                .unwrap_or_else(|e| panic!("{} encode: {e}", codec.name()));
            let back = codec
                .decode(&frame)
                .unwrap_or_else(|e| panic!("{} decode: {e}", codec.name()));
            assert_eq!(back, diff, "{} round-trip", codec.name());
        }
    }

    #[test]
    fn round_trips_an_empty_diff() {
        let diff = Object::new();
        for codec in codecs() {
            let frame = codec.encode(&diff).unwrap();
            assert_eq!(codec.decode(&frame).unwrap(), diff, "{}", codec.name());
        }
    }

    #[test]
    fn names_are_distinct() {
        let names: Vec<_> = codecs().iter().map(|c| c.name()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            sorted.len(),
            names.len(),
            "duplicate codec names: {names:?}"
        );
    }

    #[test]
    fn rejects_garbage_without_panicking() {
        let truncated: Vec<Vec<u8>> = codecs()
            .iter()
            .filter_map(|c| match c.encode(&fixture::diff()).unwrap() {
                Frame::Binary(mut bytes) => {
                    bytes.truncate(bytes.len() / 2);
                    Some(bytes)
                }
                Frame::Text(_) => None,
            })
            .collect();

        for codec in codecs() {
            assert!(codec.decode(&Frame::Binary(Vec::new())).is_err());
            assert!(codec
                .decode(&Frame::Binary(vec![0xff, 0xff, 0xff]))
                .is_err());
            for bytes in &truncated {
                assert!(
                    codec.decode(&Frame::Binary(bytes.clone())).is_err(),
                    "{} accepted a truncated frame",
                    codec.name()
                );
            }
        }
    }

    /// The failure mode of static (non-negotiated) codec configuration: a
    /// mismatched pair must error rather than silently accept the frame.
    #[cfg(all(feature = "json", feature = "cbor"))]
    #[test]
    fn a_mismatched_codec_errors() {
        let cbor = CborCodec.encode(&fixture::diff()).unwrap();
        assert!(JsonCodec.decode(&cbor).is_err());

        let json = JsonCodec.encode(&fixture::diff()).unwrap();
        assert!(CborCodec.decode(&json).is_err());
    }
}

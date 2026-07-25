use super::{into_object, Codec, Frame};
use crate::value::Object;
use crate::BoxError;

/// JSON in text frames. The default.
#[derive(Debug, Default, Clone, Copy)]
pub struct JsonCodec;

impl Codec for JsonCodec {
    fn name(&self) -> &'static str {
        "json"
    }

    fn encode(&self, diff: &Object) -> Result<Frame, BoxError> {
        Ok(Frame::Text(serde_json::to_string(diff)?))
    }

    fn decode(&self, frame: &Frame) -> Result<Object, BoxError> {
        // Lenient on purpose: UTF-8 JSON is accepted in either frame type.
        into_object(match frame {
            Frame::Text(text) => serde_json::from_str(text)?,
            Frame::Binary(bytes) => serde_json::from_slice(bytes)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::fixture;
    use crate::value::Value;

    #[test]
    fn encodes_to_a_text_frame() {
        assert!(matches!(
            JsonCodec.encode(&fixture::diff()).unwrap(),
            Frame::Text(_)
        ));
    }

    #[test]
    fn rejects_a_non_object_top_level() {
        assert!(JsonCodec.decode(&Frame::Text("[1,2]".into())).is_err());
        assert!(JsonCodec.decode(&Frame::Text("42".into())).is_err());
        assert!(JsonCodec.decode(&Frame::Text("not json".into())).is_err());
    }

    #[test]
    fn accepts_utf8_json_in_a_binary_frame() {
        let frame = Frame::Binary(br#"{"a":1}"#.to_vec());
        assert_eq!(
            JsonCodec.decode(&frame).unwrap(),
            fixture::object([("a", Value::Int(1))])
        );
    }
}

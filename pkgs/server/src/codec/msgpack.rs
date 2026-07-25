use super::{expect_binary, into_object, Codec, Frame};
use crate::value::{Object, Value};
use crate::BoxError;

/// MessagePack in binary frames.
#[derive(Debug, Default, Clone, Copy)]
pub struct MsgpackCodec;

impl Codec for MsgpackCodec {
    fn name(&self) -> &'static str {
        "msgpack"
    }

    fn encode(&self, diff: &Object) -> Result<Frame, BoxError> {
        // `to_vec_named` keeps maps string-keyed, which is what the JS side reads.
        Ok(Frame::Binary(rmp_serde::to_vec_named(diff)?))
    }

    fn decode(&self, frame: &Frame) -> Result<Object, BoxError> {
        let bytes = expect_binary(frame, self.name())?;
        into_object(rmp_serde::from_slice::<Value>(bytes)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::fixture;

    #[test]
    fn encodes_to_a_binary_frame() {
        assert!(matches!(
            MsgpackCodec.encode(&fixture::diff()).unwrap(),
            Frame::Binary(_)
        ));
    }

    #[test]
    fn rejects_a_text_frame() {
        assert!(MsgpackCodec.decode(&Frame::Text("{}".into())).is_err());
    }

    /// `81` fixmap(1), `A1 61` fixstr "a", `C3` true.
    #[test]
    fn message_format_is_stable() {
        let diff = fixture::object([("a", Value::Bool(true))]);
        assert_eq!(
            MsgpackCodec.encode(&diff).unwrap(),
            Frame::Binary(vec![0x81, 0xA1, 0x61, 0xC3])
        );
    }
}

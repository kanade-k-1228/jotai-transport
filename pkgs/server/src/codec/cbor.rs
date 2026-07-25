use super::{expect_binary, into_object, Codec, Frame};
use crate::value::{Object, Value};
use crate::BoxError;

#[derive(Debug, Default, Clone, Copy)]
pub struct CborCodec;

impl Codec for CborCodec {
    fn name(&self) -> &'static str {
        "cbor"
    }

    fn encode(&self, diff: &Object) -> Result<Frame, BoxError> {
        let mut buf = Vec::new();
        ciborium::into_writer(diff, &mut buf)?;
        Ok(Frame::Binary(buf))
    }

    fn decode(&self, frame: &Frame) -> Result<Object, BoxError> {
        let bytes = expect_binary(frame, self.name())?;
        into_object(ciborium::from_reader::<Value, _>(bytes)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::fixture;

    #[test]
    fn encodes_to_a_binary_frame() {
        assert!(matches!(
            CborCodec.encode(&fixture::diff()).unwrap(),
            Frame::Binary(_)
        ));
    }

    #[test]
    fn rejects_a_text_frame() {
        assert!(CborCodec.decode(&Frame::Text("{}".into())).is_err());
    }

    /// Pins the encoded bytes so a ciborium bump can't silently change what
    /// browsers have to parse. `A1` map(1), `61 61` text "a", `F5` true.
    #[test]
    fn message_format_is_stable() {
        let diff = fixture::object([("a", Value::Bool(true))]);
        assert_eq!(
            CborCodec.encode(&diff).unwrap(),
            Frame::Binary(vec![0xA1, 0x61, 0x61, 0xF5])
        );
    }
}

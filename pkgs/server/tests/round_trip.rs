use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, Stream, StreamExt};
use jotai_transport::{serve_with_codec, store, Atom, Codec, Frame, Object, Store, Value};
use tokio_tungstenite::tungstenite::Message;

/// An atom that accepts and echoes back whatever it is given.
struct Cell(Option<Value>);

impl Atom for Cell {
    fn value(&self) -> Option<Value> {
        self.0.clone()
    }

    fn commit(&mut self, value: Value) {
        self.0 = Some(value);
    }

    fn parse(&self, raw: &Value) -> Option<Value> {
        Some(raw.clone())
    }
}

/// An atom whose value lives outside the process, reachable through `load`.
/// The handle lets a test change it the way a sensor or a config file would.
struct Backed {
    value: Option<Value>,
    external: Arc<Mutex<Value>>,
}

impl Atom for Backed {
    fn value(&self) -> Option<Value> {
        self.value.clone()
    }

    fn commit(&mut self, value: Value) {
        self.value = Some(value);
    }

    fn load(&self) -> Option<Value> {
        Some(self.external.lock().unwrap().clone())
    }
}

fn object<const N: usize>(entries: [(&str, Value); N]) -> Object {
    entries
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

fn to_message(frame: Frame) -> Message {
    match frame {
        Frame::Text(text) => Message::Text(text),
        Frame::Binary(bytes) => Message::Binary(bytes),
    }
}

fn from_message(message: Message) -> Frame {
    match message {
        Message::Text(text) => Frame::Text(text),
        Message::Binary(bytes) => Frame::Binary(bytes),
        other => panic!("unexpected frame: {other:?}"),
    }
}

/// A port nothing is listening on. Racy in principle, fine in practice.
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn recv<S>(socket: &mut S, codec: &dyn Codec) -> Object
where
    S: Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .expect("timed out waiting for a frame")
        .expect("stream ended")
        .expect("socket error");
    codec.decode(&from_message(message)).expect("decode")
}

async fn round_trip<C: Codec + Default>() {
    let codec = C::default();
    let port = free_port();
    let store: Store = store! {
        "count" => Cell(Some(Value::Int(0))),
        "pending" => Cell(None),
    };
    tokio::spawn(serve_with_codec(store, C::default(), "127.0.0.1", port));

    let url = format!("ws://127.0.0.1:{port}");
    let mut socket = loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((socket, _)) => break socket,
            Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
        }
    };

    // The snapshot omits `pending`, whose atom has no value yet — that absence
    // is what makes the client's atom suspend.
    let snapshot = recv(&mut socket, &codec).await;
    assert_eq!(
        snapshot,
        object([("count", Value::Int(0))]),
        "{}",
        codec.name()
    );

    let write = object([
        ("count", Value::Int(7)),
        ("unknown", Value::Str("dropped".into())),
    ]);
    let frame = codec.encode(&write).expect("encode");
    socket.send(to_message(frame)).await.expect("send");

    // Only the accepted keys come back; `unknown` has no atom.
    let echo = recv(&mut socket, &codec).await;
    assert_eq!(echo, object([("count", Value::Int(7))]), "{}", codec.name());
}

#[cfg(feature = "json")]
#[tokio::test]
async fn json_round_trips_over_a_socket() {
    round_trip::<jotai_transport::JsonCodec>().await;
}

#[cfg(feature = "cbor")]
#[tokio::test]
async fn cbor_round_trips_over_a_socket() {
    round_trip::<jotai_transport::CborCodec>().await;
}

#[cfg(feature = "msgpack")]
#[tokio::test]
async fn msgpack_round_trips_over_a_socket() {
    round_trip::<jotai_transport::MsgpackCodec>().await;
}

/// The refresh timer is the only way a value that nothing wrote reaches a
/// client. Runs on JSON alone: the codecs are covered by the round trip above,
/// and what is under test here is the broadcast, not the encoding.
#[cfg(feature = "json")]
#[tokio::test]
async fn a_changed_backing_value_reaches_a_connected_client() {
    use jotai_transport::JsonCodec;

    let codec = JsonCodec;
    let port = free_port();
    let external = Arc::new(Mutex::new(Value::Int(1)));
    let store: Store = store! {
        "sensor" => Backed { value: None, external: external.clone() },
    };
    tokio::spawn(serve_with_codec(store, JsonCodec, "127.0.0.1", port));

    let url = format!("ws://127.0.0.1:{port}");
    let mut socket = loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((socket, _)) => break socket,
            Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
        }
    };

    // Nothing has been written, and the atom starts with no value at all, so
    // the first frame can only come from the refresh timer reading `load`.
    assert_eq!(
        recv(&mut socket, &codec).await,
        object([("sensor", Value::Int(1))])
    );

    *external.lock().unwrap() = Value::Int(2);
    assert_eq!(
        recv(&mut socket, &codec).await,
        object([("sensor", Value::Int(2))])
    );

    // Several ticks with the value unchanged, then a real change. If refresh
    // broadcast unchanged values, the next frame would be a stale `2`.
    tokio::time::sleep(Duration::from_millis(400)).await;
    *external.lock().unwrap() = Value::Int(3);
    assert_eq!(
        recv(&mut socket, &codec).await,
        object([("sensor", Value::Int(3))])
    );
}

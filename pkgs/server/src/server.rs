use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;

use crate::codec::{Codec, Frame};
use crate::value::Object;
use crate::Store;

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

const REFRESH_INTERVAL: Duration = Duration::from_millis(100);

type ClientId = u64;

struct State {
    store: Store,
    pending: HashMap<ClientId, Object>,
}

struct Hub {
    state: Mutex<State>,
    notify: Notify,
    next_id: AtomicU64,
}

impl Hub {
    fn new(store: Store) -> Self {
        Hub {
            state: Mutex::new(State {
                store,
                pending: HashMap::new(),
            }),
            notify: Notify::new(),
            next_id: AtomicU64::new(0),
        }
    }

    fn connect(&self) -> ClientId {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut state = self.state.lock().unwrap();
        let snapshot = state.store.snapshot();
        state.pending.insert(id, snapshot);
        id
    }

    fn disconnect(&self, id: ClientId) {
        self.state.lock().unwrap().pending.remove(&id);
    }

    fn update(&self, partial: Object) {
        let mut state = self.state.lock().unwrap();
        let accepted = state.store.update(partial);
        if accepted.is_empty() {
            return;
        }
        Self::enqueue(&mut state.pending, &accepted);
        drop(state);
        self.notify.notify_waiters();
    }

    fn refresh(&self) {
        let mut state = self.state.lock().unwrap();
        let changed = state.store.refresh();
        if changed.is_empty() {
            return;
        }
        Self::enqueue(&mut state.pending, &changed);
        drop(state);
        self.notify.notify_waiters();
    }

    fn enqueue(pending: &mut HashMap<ClientId, Object>, values: &Object) {
        for diff in pending.values_mut() {
            for (key, value) in values {
                diff.insert(key.clone(), value.clone());
            }
        }
    }

    /// Takes and clears this client's pending diff, if it has one queued.
    fn take_pending(&self, id: ClientId) -> Option<Object> {
        let mut state = self.state.lock().unwrap();
        let diff = state.pending.get_mut(&id)?;
        if diff.is_empty() {
            return None;
        }
        Some(std::mem::take(diff))
    }
}

fn to_message(frame: Frame) -> Message {
    match frame {
        Frame::Text(text) => Message::Text(text),
        Frame::Binary(bytes) => Message::Binary(bytes),
    }
}

/// Run the transport server with the default JSON codec.
#[cfg(feature = "json")]
pub async fn serve(store: Store, host: &str, port: u16) -> Result<(), BoxError> {
    serve_with_codec(store, crate::codec::JsonCodec, host, port).await
}

/// Run the transport server with an explicit messaging format.
///
/// The codec is not negotiated: the client must be configured with the
/// matching format, or nothing will decode on either side.
pub async fn serve_with_codec<C: Codec>(
    store: Store,
    codec: C,
    host: &str,
    port: u16,
) -> Result<(), BoxError> {
    serve_impl(store, Arc::new(codec), host, port).await
}

async fn serve_impl(
    store: Store,
    codec: Arc<dyn Codec>,
    host: &str,
    port: u16,
) -> Result<(), BoxError> {
    let hub = Arc::new(Hub::new(store));

    {
        let hub = hub.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(REFRESH_INTERVAL);
            loop {
                ticker.tick().await;
                hub.refresh();
            }
        });
    }

    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr).await?;
    println!("[transport] listening on ws://{addr} ({})", codec.name());

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("[transport] accept error: {e}");
                continue;
            }
        };
        let hub = hub.clone();
        let codec = codec.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, peer, hub, codec).await {
                eprintln!("[transport {peer}] error: {e}");
            }
        });
    }
}

async fn handle_conn(
    stream: TcpStream,
    peer: SocketAddr,
    hub: Arc<Hub>,
    codec: Arc<dyn Codec>,
) -> Result<(), BoxError> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws.split();

    let id = hub.connect();
    println!("[transport {peer}] connected");

    // Drains this client's pending diff (starting with its initial snapshot)
    // until the socket dies. `notified()` is created before checking the
    // pending diff so a notification that lands in between is never missed.
    let sender_hub = hub.clone();
    let sender_codec = codec.clone();
    let sender = tokio::spawn(async move {
        loop {
            let notified = sender_hub.notify.notified();
            if let Some(diff) = sender_hub.take_pending(id) {
                let frame = match sender_codec.encode(&diff) {
                    Ok(frame) => frame,
                    Err(e) => {
                        // `take_pending` already removed the diff, so dropping
                        // it here would desync this client forever. Closing
                        // makes the client reconnect onto a fresh snapshot.
                        eprintln!("[transport {peer}] encode failed: {e}");
                        let _ = write.close().await;
                        break;
                    }
                };
                if write.send(to_message(frame)).await.is_err() {
                    break;
                }
                continue;
            }
            notified.await;
        }
    });

    while let Some(msg) = read.next().await {
        let frame = match msg {
            Ok(Message::Text(t)) => Frame::Text(t),
            Ok(Message::Binary(b)) => Frame::Binary(b),
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => continue, // ignore ping / pong
        };
        match codec.decode(&frame) {
            Ok(partial) => hub.update(partial),
            Err(e) => eprintln!("[transport {peer}] {} decode failed: {e}", codec.name()),
        }
    }

    sender.abort();
    hub.disconnect(id);
    println!("[transport {peer}] disconnected");
    Ok(())
}

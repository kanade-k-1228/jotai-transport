use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::Store;

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// Listener configuration.
#[derive(Clone, Debug)]
pub struct ServerOptions {
    pub host: String,
    pub port: u16,
}

impl Default for ServerOptions {
    fn default() -> Self {
        ServerOptions {
            host: "0.0.0.0".to_string(),
            port: 8137,
        }
    }
}

/// Run the transport server, accepting connections until the listener fails.
pub async fn serve(store: Store, options: ServerOptions) -> Result<(), BoxError> {
    let store = Arc::new(Mutex::new(store));

    // Outbound fan-out. subscribe() keeps working with zero live receivers, so we
    // don't need to hold on to the initial one.
    let (tx, _) = broadcast::channel::<String>(64);

    let addr = format!("{}:{}", options.host, options.port);
    let listener = TcpListener::bind(&addr).await?;
    println!("[transport] listening on ws://{addr}");

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("[transport] accept error: {e}");
                continue;
            }
        };
        let store = store.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, peer, store, tx).await {
                eprintln!("[transport {peer}] error: {e}");
            }
        });
    }
}

async fn handle_conn(
    stream: TcpStream,
    peer: SocketAddr,
    store: Arc<Mutex<Store>>,
    tx: broadcast::Sender<String>,
) -> Result<(), BoxError> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws.split();

    // Subscribe before reading the snapshot so no update is lost in between.
    let mut rx = tx.subscribe();
    println!("[transport {peer}] connected (clients: {})", tx.receiver_count());

    // Send the current full store as the initial snapshot.
    let snapshot = store.lock().unwrap().snapshot();
    write.send(Message::Text(snapshot)).await?;

    // Forward every broadcast to this client until the socket dies.
    let forward = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = read.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => continue, // ignore binary / ping / pong
        };

        // Merge into the store; broadcast the new snapshot it returns.
        let to_broadcast = store.lock().unwrap().apply(&text);
        if let Some(json) = to_broadcast {
            let _ = tx.send(json);
        }
    }

    forward.abort();
    println!("[transport {peer}] disconnected");
    Ok(())
}

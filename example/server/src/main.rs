use clap::{Parser, ValueEnum};
use rppal::gpio::Gpio;
use transport_server::{serve_with_codec, store, BoxError, CborCodec, JsonCodec, MsgpackCodec};

mod led;
use led::LedAtom;

/// Messaging format. The client must be configured to match.
#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Json,
    Cbor,
    Msgpack,
}

#[derive(Parser)]
#[command(name = "rgb-led-server", version, about)]
struct Args {
    #[arg(long, default_value_t = 8137)]
    port: u16,

    #[arg(long, value_enum, default_value_t = Format::Json)]
    codec: Format,

    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    #[arg(long, default_value_t = 17)]
    red_pin: u8,

    #[arg(long, default_value_t = 27)]
    yellow_pin: u8,

    #[arg(long, default_value_t = 22)]
    green_pin: u8,
}

#[tokio::main]
async fn main() -> Result<(), BoxError> {
    let args = Args::parse();
    let gpio = match Gpio::new() {
        Ok(g) => {
            println!("[gpio] driving LEDs");
            Some(g)
        }
        Err(e) => {
            println!("[gpio] hardware unavailable: {e}");
            None
        }
    };
    let gpio = gpio.as_ref();
    let store = store! {
        "red" => LedAtom::new(gpio, args.red_pin),
        "yellow" => LedAtom::new(gpio, args.yellow_pin),
        "green" => LedAtom::new(gpio, args.green_pin),
    };
    match args.codec {
        Format::Json => serve_with_codec(store, JsonCodec, &args.host, args.port).await,
        Format::Cbor => serve_with_codec(store, CborCodec, &args.host, args.port).await,
        Format::Msgpack => serve_with_codec(store, MsgpackCodec, &args.host, args.port).await,
    }
}

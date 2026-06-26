use clap::Parser;
use rppal::gpio::Gpio;
use transport_server::{serve, store, BoxError};

mod led;
use led::LedAtom;

#[derive(Parser)]
#[command(name = "rgb-led-server", version, about)]
struct Args {
    #[arg(long, default_value_t = 8137)]
    port: u16,

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
    serve(store, &args.host, args.port).await
}

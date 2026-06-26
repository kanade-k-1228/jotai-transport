use clap::Parser;
use rppal::gpio::Gpio;
use transport_server::{serve, store, BoxError, ServerOptions};

mod led;
use led::LedAtom;

/// jotai-transport server that mirrors a traffic signal (red / yellow / green)
/// onto Raspberry Pi GPIO LEDs.
#[derive(Parser)]
#[command(name = "rgb-led-server", version, about)]
struct Args {
    /// TCP port to listen on.
    #[arg(long, default_value_t = 8137)]
    port: u16,

    /// Host / interface to bind.
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// BCM pin for the red LED.
    #[arg(long, default_value_t = 17)]
    red_pin: u8,

    /// BCM pin for the yellow LED.
    #[arg(long, default_value_t = 27)]
    yellow_pin: u8,

    /// BCM pin for the green LED.
    #[arg(long, default_value_t = 22)]
    green_pin: u8,

    /// Invert the LED logic (pin LOW = on) instead of active-high.
    #[arg(long)]
    inverse: bool,
}

#[tokio::main]
async fn main() -> Result<(), BoxError> {
    let args = Args::parse();
    let options = ServerOptions {
        host: args.host.clone(),
        port: args.port,
    };
    let gpio = match Gpio::new() {
        Ok(g) => {
            println!(
                "[gpio] driving LEDs (active-{})",
                if args.inverse { "low" } else { "high" }
            );
            Some(g)
        }
        Err(e) => {
            println!("[gpio] hardware unavailable ({e}); running in MOCK mode (state is logged only)");
            None
        }
    };
    let gpio = gpio.as_ref();
    let store = store! {
        "red" => LedAtom::new("R", gpio, args.red_pin, args.inverse),
        "yellow" => LedAtom::new("Y", gpio, args.yellow_pin, args.inverse),
        "green" => LedAtom::new("G", gpio, args.green_pin, args.inverse),
    };
    serve(store, options).await
}

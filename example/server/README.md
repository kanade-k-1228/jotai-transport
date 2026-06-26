# rgb-led-server

A jotai-transport server, written in Rust, that mirrors a tiny store of three
booleans (`red` / `green` / `blue`) onto three GPIO LEDs on a Raspberry Pi.

The WebSocket protocol, the `Atom` trait, and the `Store` come from the
[`jotai-transport`](../../pkgs/server) crate (a path dependency, referenced here as
`transport_server`). This binary only provides the concrete atoms: each key is an
`Atom` whose `set` drives a GPIO pin, declared with the crate's `store!` macro. The
existing Vite/React client works unchanged.

## Protocol

- On connect the server sends the full store once: `{"red":false,"green":false,"blue":false}`
- The client sends partial updates: `{"red":true}`
- After merging, the server broadcasts the full store to **every** client (including the sender)
- Invalid JSON / wrong-typed values are silently ignored

## Wiring (default)

| Store key | BCM pin | Physical pin |
| --------- | ------- | ------------ |
| `red`     | GPIO17  | 11           |
| `green`   | GPIO27  | 13           |
| `blue`    | GPIO22  | 15           |

Default wiring is **active-high**: connect each LED's anode (+, longer leg) to the
GPIO pin through a current-limiting resistor (e.g. 330Ω), and the cathode (−) to GND.
`store value = true` → pin HIGH → LED on.

## Configuration (CLI flags via clap)

Run `rgb-led-server --help` for the full list.

| Flag            | Default   | Meaning                              |
| --------------- | --------- | ------------------------------------ |
| `--port`        | `8137`    | TCP port to listen on                |
| `--host`        | `0.0.0.0` | Host / interface to bind             |
| `--red-pin`     | `17`      | BCM pin for the red LED              |
| `--green-pin`   | `27`      | BCM pin for the green LED            |
| `--blue-pin`    | `22`      | BCM pin for the blue LED             |
| `--inverse`     | (off)     | Invert LED logic (pin LOW = on)      |

If GPIO hardware is unavailable (e.g. on a laptop / WSL), the server automatically
falls back to a **mock mode** that just logs the LED state — handy for testing the
protocol and the client without a Pi.

## Run locally (mock mode)

```sh
cargo run
# [gpio] hardware unavailable (...); running in MOCK mode
# [transport] listening on ws://0.0.0.0:8137

# pass flags after `--`, e.g. a different port:
cargo run -- --port 9000
```

Then start the client: `( cd example/client && pnpm dev )` and open the printed URL.
Vite proxies `/ws` to `localhost:8137`.

## Build & run on the Raspberry Pi

Build on the Pi directly (simplest):

```sh
cargo build --release
./target/release/rgb-led-server --port 8137
```

Or cross-compile from your machine with [`cross`](https://github.com/cross-rs/cross):

```sh
# 64-bit Pi OS (Pi 3/4/5)
cross build --release --target aarch64-unknown-linux-gnu
# 32-bit Pi OS
cross build --release --target armv7-unknown-linux-gnueabihf
```

Copy the binary to the Pi and run it (e.g. with custom pins:
`./rgb-led-server --red-pin 17 --green-pin 27 --blue-pin 22`). To drive the LEDs
from your laptop's browser, point the dev client at the Pi:

```sh
( cd example/client && SERVER_HOST=<pi-ip> pnpm dev )
```

### Run as a service (optional)

`/etc/systemd/system/rgb-led-server.service`:

```ini
[Unit]
Description=jotai-transport RGB LED server
After=network.target

[Service]
ExecStart=/home/pi/rgb-led-server --port 8137
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now rgb-led-server
```

> Note: this server only handles the WebSocket. Serving the built client (static
> files) from the Pi is left out of scope; in development Vite serves the page and
> proxies `/ws`. To self-host the page on the Pi, build the client
> (`cd example/client && pnpm build`) and serve `example/client/dist` with any
> static file server.

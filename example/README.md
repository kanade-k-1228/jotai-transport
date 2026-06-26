# jotai-transport example

A traffic-light demo that keeps three booleans (`red` / `yellow` / `green`) in sync
between a web UI and a Rust server. The server drives real GPIO LEDs on a Raspberry
Pi, or just logs the state when no hardware is present.

## Run

```sh
./run.sh
```

This builds and starts the server and the web client; open the URL Vite prints
(default http://localhost:5173). Stop everything with Ctrl-C.

## Raspberry Pi pin layout

LEDs are active-high (pin HIGH = on). Wire each one as:

```
GPIO ──[ 330Ω ]──▶|── GND
                  LED
```

| LED    | BCM  | Physical pin |
| ------ | ---- | ------------ |
| red    | 17   | 11           |
| yellow | 27   | 13           |
| green  | 22   | 15           |

Use any ground pin (e.g. physical 6, 9, or 14) for the common cathode side.
Override the defaults with `--red-pin` / `--yellow-pin` / `--green-pin`.

# jotai-transport example

A traffic-light demo that keeps three booleans (`red` / `yellow` / `green`) in sync
between a web UI and a Rust server. The server drives real GPIO LEDs on a Raspberry
Pi, or just logs the state when no hardware is present.

## Run

```sh
make run
```

This builds and starts the server and the web client; open the URL Vite prints
(default http://localhost:5173). Stop everything with Ctrl-C.

| target | what it does |
| ------ | ------------ |
| `make run` | server + dev client together (the default target) |
| `make server` | server only |
| `make client` | dev client only, against a server already on `PORT` |
| `make build` | production build of both |
| `make check` | typecheck and build both without running anything |
| `make clean` | drop build output |

Variables: `PORT` (8137), `HOST` (0.0.0.0), `SERVER_HOST` (the host the browser
proxies to — set it to your Pi's address), `CODEC` (see below). For example,
`make run SERVER_HOST=192.168.1.42`.

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

## Messaging format

The server takes `--codec json|cbor|msgpack` (default `json`, or `make CODEC=…`)
to show `serve_with_codec` in use. There is no negotiation, so the web client
here — which uses the default JSON codec — only works against `json`. Point your
own client at the other two, passing a matching `codec` to `createTransport`
(see `pkgs/client/README.md`):

```sh
make server CODEC=cbor
```

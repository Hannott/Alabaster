# Fake printers

Six simulated Moonrakers in Docker, so the Farm rail and anything else that
needs more than one machine can be developed without owning six printers.

```bash
docker compose -f compose.fake-printers.yaml up -d
```

Then add the addresses in **Settings → Printers**:

| Address                         | Pretends to be                                           |
| ------------------------------- | -------------------------------------------------------- |
| `ws://localhost:7131/websocket` | Voron 2.4 — printing ABS, camera, queue of 3             |
| `ws://localhost:7132/websocket` | Prusa MK4 — printing, Spoolman, power switch, queue of 5 |
| `ws://localhost:7133/websocket` | Ender bench — finished a print, no camera                |
| `ws://localhost:7134/websocket` | Enclosure box — paused mid-print, queue held             |
| `ws://localhost:7135/websocket` | Trident — Klipper shut down, camera still live           |
| `ws://localhost:7136/websocket` | Locked down — refuses this page's origin                 |

`docker compose -f compose.fake-printers.yaml down` stops them all.

## What it simulates

Each instance runs one machine that behaves plausibly rather than correctly:
heaters chase their targets and wobble around them, a print advances at its
configured rate, and a finished print rolls into the next queued job unless the
queue is held. The camera draws a real frame per request — the printer's name,
its state, a clock and a bar that tracks progress — so a frozen stream is
impossible to mistake for a working one.

It answers the JSON-RPC methods Alabaster actually calls, and pushes
`notify_status_update`, `notify_job_queue_changed`, `notify_power_changed` and
`notify_proc_stat_update` the way Moonraker does. Anything not implemented
answers `Method not found`, which is what a real Moonraker says for a component
that is not configured — so an unimplemented call reads as an absent feature
rather than as a broken server.

**It is not Klipper.** No G-code is parsed, nothing moves, and no configuration
is validated. Use it for interface work; use a real printer for anything that
depends on what Klipper actually does.

## The one that refuses

`7136` sets `CORS=none`, so it rejects every websocket upgrade the way a
Moonraker whose `cors_domains` does not list your address does. It exists
because that failure is indistinguishable from a printer being switched off
until something probes HTTP — which is exactly what Alabaster's farm column
does before it says **Refused** rather than **Offline**. It is the cheapest way
to see that path without editing a real printer's `moonraker.conf`.

## Configuring an instance

Everything is environment variables; see `compose.fake-printers.yaml` for
worked examples.

| Variable        | Default            | Meaning                                                                                                                       |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `PRINTER_NAME`  | `Fake printer`     | Shown in `printer.info` and drawn on the camera frame.                                                                        |
| `SCENARIO`      | `printing`         | `printing` · `paused` · `complete` · `idle` · `error` · `shutdown`                                                            |
| `FILENAME`      | `bracket_v3.gcode` | The job it claims to be running.                                                                                              |
| `PRINT_SECONDS` | `900`              | How long a whole print takes. Short values make progress visible.                                                             |
| `LAYERS`        | `214`              | Layer count, for the layer counter.                                                                                           |
| `QUEUE`         | `3`                | How many jobs to seed the queue with.                                                                                         |
| `QUEUE_PAUSED`  | `false`            | Start with the queue held.                                                                                                    |
| `CAMERA`        | `true`             | Serve a webcam at all.                                                                                                        |
| `POWER`         | `false`            | Advertise the `power` component and one switch.                                                                               |
| `SPOOLMAN`      | `false`            | Advertise `spoolman` and answer with a simulated spool.                                                                       |
| `MATERIAL`      | `PLA`              | Drives the filament row and the temperature targets.                                                                          |
| `COLOR`         | `E69F00`           | Filament colour, hex without the `#`.                                                                                         |
| `CORS`          | `all`              | `all`, `none`, or a comma-separated list of allowed origins.                                                                  |
| `LOG_RPC`       | unset              | Print every JSON-RPC method received. Useful when a column stays empty and you need to know whether the request ever arrived. |

## Adding more

Copy a service block in `compose.fake-printers.yaml`, give it a free port, and
point Alabaster at it. Nothing in the image is per-printer; the whole
personality is environment.

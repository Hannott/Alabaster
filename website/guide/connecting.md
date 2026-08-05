# Connecting to Moonraker

Alabaster opens one WebSocket to Moonraker and connects on its own. There is
nothing to start.

## Where it looks by default

`/websocket` on the same origin as the page. That is what a printer's own Pi
serves, so a same-origin install connects with no configuration at all.

Served from a separate host, that default finds nothing. Adding a printer is the
first thing you do.

## Setting the address

Open **Settings → Printer service** and enter the address. Three forms work:

| You type                            | Alabaster uses                      |
| ----------------------------------- | ----------------------------------- |
| `printer.local:7125`                | `ws://printer.local:7125/websocket` |
| `http://192.168.1.42:7125`          | `ws://192.168.1.42:7125/websocket`  |
| `ws://printer.local:7125/websocket` | exactly that                        |

The `/websocket` path is added when it is missing. Choose **Save and connect**.

The address is saved in this browser. Other browsers, and other devices, keep
their own.

## Letting your browser reach Moonraker

Cross-origin — which means any printer that did not serve the page — needs your
browser's address in that printer's `moonraker.conf`:

```ini
[authorization]
cors_domains:
    http://alabaster.local
```

Restart Moonraker after changing it. [Installation](/guide/installation#allow-the-browser-to-reach-moonraker)
has the fuller example.

Alabaster tells the two failures apart where it can:

- **"Moonraker could not be reached"** — nothing answered. Wrong address, wrong
  port, or the printer is off.
- **"Something answered, but refused the connection"** — a server is there and
  turned you away. Almost always a missing `cors_domains` entry.

It only ever moves from the first message to the second, never the other way, and
only for a printer this browser has never successfully reached. A reconnect blip
after a restart is never reported as a permissions problem.

## Logging in

Separate from the trust above, and rarer: a printer can require an actual
username and password, configured with `force_logins` in the same
`[authorization]` block. Most printers never turn this on — `cors_domains` and
`trusted_clients` are about which browsers Moonraker will talk to at all, not
about who is allowed to act once connected, and one has nothing to do with the
other.

If your printer does require a login, Settings grows a **Users** category —
otherwise it stays hidden. [Settings → Users](/interface/settings#users) covers
logging in, changing your password, and managing other accounts.

## What happens after connecting

In order:

1. Alabaster identifies itself to Moonraker.
2. It reads `server.info` to find out which components and file roots exist.
3. It follows Klipper's lifecycle notifications, and polls while Klipper is still
   starting.
4. It subscribes to the printer objects the open screens need.

Navigation reflects step 2. Destinations that need something your Moonraker does
not have are not shown at all — Timelapse without the timelapse component,
History without the history component, Configuration without a `config_path`.

Step 4 is what fills the dashboard: every heater, temperature sensor, temperature
fan, controllable fan, output pin, macro, motion limit, and the bed mesh, all
discovered from the printer rather than configured by you.

## Losing and regaining the connection

The connection status lives in the header, and it is the only global one. Modules
do not each grow their own status panel.

While a service is away:

- **The page stays exactly as it is.** No reload, no route change, no empty
  frame.
- **Values stay on screen, dimmed**, and are labelled as last-known rather than
  current.
- **Fresh data crossfades back in** when subscriptions are rebuilt.

Reconnecting re-reads server state and recreates every subscription without
touching what you were doing.

::: warning Interrupted commands are not replayed
A command that was in flight when the connection dropped fails visibly. Alabaster
will not send it again on your behalf — a retried heater target or a retried
print start is not a safe guess. You are told, and you retry it yourself.
:::

## Restarting things on purpose

The power menu in the header restarts what you ask it to, and the page survives
all of it:

| Action            | What it restarts                                                    |
| ----------------- | ------------------------------------------------------------------- |
| Restart Klipper   | The Klipper host process.                                           |
| Firmware restart  | Klipper and the microcontrollers.                                   |
| Restart Moonraker | The Moonraker service.                                              |
| Reboot host       | The whole computer. Asks first.                                     |
| Shut down host    | Powers it off. Asks first, and warns you will need physical access. |

Any device power switches Moonraker knows about appear in the same menu, and are
locked while a print is running.

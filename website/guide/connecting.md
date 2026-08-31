# Connecting to Moonraker

Alabaster opens one WebSocket to Moonraker and connects on its own. There is
nothing to start.

## Where it looks by default

Alabaster looks for `/websocket` on the same origin as the page. A printer's
own Raspberry Pi serves the page from that origin, so a same-origin install
connects with no configuration.

A separate host does not serve Moonraker at that origin. Add the printer's
address to connect.

## Setting the address

Open **Settings → Printer service** and enter the address. Three forms work:

| You type                            | Alabaster uses                      |
| ----------------------------------- | ----------------------------------- |
| `printer.local:7125`                | `ws://printer.local:7125/websocket` |
| `http://192.168.1.42:7125`          | `ws://192.168.1.42:7125/websocket`  |
| `ws://printer.local:7125/websocket` | exactly that                        |

Alabaster adds the `/websocket` path when it is missing. Click **Save and
connect**.

The address is saved in this browser only. Other browsers, and other
devices, keep their own.

## Letting your browser reach Moonraker

A cross-origin connection is any printer that did not serve the page itself.
It needs your browser's address in that printer's `moonraker.conf`:

```ini
[authorization]
cors_domains:
    http://alabaster.local
```

Restart Moonraker after changing it. See
[Installation](/guide/installation#allow-the-browser-to-reach-moonraker) for
a fuller example.

Alabaster reports two different connection failures:

- **"Moonraker could not be reached"**: nothing answered. Check the address,
  the port, and whether the printer is on.
- **"Something answered, but refused the connection"**: a server responded
  and turned the connection away. This is almost always a missing
  `cors_domains` entry.

Alabaster only moves from the first message to the second, never the other
way, and only for a printer this browser has never successfully reached. A
reconnect after a restart is never reported as a permissions problem.

## Logging in

A printer can also require a username and password, set with `force_logins`
in the same `[authorization]` block. Most printers do not turn it on.

`cors_domains` and `trusted_clients` control which browsers Moonraker
accepts. They do not control who can act once connected.

If your printer requires a login, Settings shows a **Users** category.
Otherwise it stays hidden. See
[Settings → Users](/interface/settings#users) for logging in, changing your
password, and managing other accounts.

## What happens after connecting

In order:

1. Alabaster identifies itself to Moonraker.
2. It reads `server.info` to find out which components and file roots exist.
3. It follows Klipper's lifecycle notifications, and polls while Klipper is
   still starting.
4. It subscribes to the printer objects the open screens need.

Navigation reflects step 2. Alabaster hides destinations that need something
your Moonraker does not have: Timelapse without the timelapse component,
History without the history component, Configuration without a
`config_path`.

Step 4 fills the dashboard: every heater, temperature sensor, temperature
fan, controllable fan, output pin, macro, motion limit, and the bed mesh.
Alabaster discovers all of these from the printer; you do not configure them.

## Losing and regaining the connection

The connection status is shown in the header. This is the only global status
indicator. Modules do not each show their own status panel.

While a service is unavailable:

- **The page stays exactly as it is.** No reload, no route change, no empty
  frame.
- **Values stay on screen, dimmed**, and are labelled as last-known rather
  than current.
- **Fresh data crossfades back in** when subscriptions are rebuilt.

Reconnecting re-reads server state and recreates every subscription. It does
not touch what you were doing.

::: warning Interrupted Commands Are Not Replayed
A command in flight when the connection drops fails visibly. Alabaster does
not resend it, and does not guess whether a heater target or a print start is
safe to repeat. Retry it yourself.
:::

## Restarting things on purpose

The power menu in the header restarts what you ask it to. The page survives
all of it:

| Action            | What it restarts                                                    |
| ----------------- | ------------------------------------------------------------------- |
| Restart Klipper   | The Klipper host process.                                           |
| Firmware restart  | Klipper and the microcontrollers.                                   |
| Restart Moonraker | The Moonraker service.                                              |
| Reboot host       | The whole computer. Asks first.                                     |
| Shut down host    | Powers it off. Asks first, and warns you will need physical access. |

Any device power switches Moonraker knows about appear in the same menu. They
are locked while a print is running.

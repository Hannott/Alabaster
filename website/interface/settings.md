# Settings

Seven categories, chosen from a rail that stays put while you scroll. Pick one
and only that card is shown; **Show all settings** brings the rest back.

Your choice is remembered, so leaving the page and coming back does not reset it.

## Printer service

The Moonraker connection for the printer you are on.

Enter a hostname, an HTTP address, or a complete WebSocket address — the
`/websocket` path is added when it is missing — and choose **Save and connect**.

The status reads Disconnected, Connecting, Starting session, Connected, or
Reconnecting. Failures say which failure it is: nothing answered, or something
answered and refused you.

[Connecting to Moonraker](/guide/connecting) covers the addresses and the CORS
setup.

## Printers

Every printer you have saved, and which one is live.

Add one with its address and an optional name. When adding, you can **copy the
dashboard from a printer you already set up** — layout, modules, and their
configuration — which is worth doing for a second machine of the same model.

Rename or remove any of them. Removing does not delete what you configured: add
the printer back and its dashboard returns.

[Several printers](/guide/printers) has the whole picture, including why settings
follow a printer's identity rather than its address.

## Users

Only appears when the printer you are on actually requires a login. Most
printers never configure this, so most people will never see this category —
Alabaster otherwise treats your network as trusted, and there is nothing here
to hide it behind.

If your printer does require one, log in with a username and password.
Alabaster remembers the session on this device, so this is normally only
needed once.

Once logged in, you can:

- **Change your password.**
- **Add another user.** This logs _this device_ in as the account you just
  created — the same way signing up anywhere else does. Log back in as
  yourself afterward if you meant to keep managing the printer.
- **Remove another user's account**, though not your own — Moonraker requires
  a different logged-in account to do that.
- **See and regenerate the API key**, for other Moonraker clients — a mobile
  app, a script — that cannot log in interactively.

[Connecting to Moonraker](/guide/connecting#logging-in) covers how a printer
comes to require this in the first place, and how it differs from the
CORS trust you set up for a printer on another host.

## Language and format

**Interface language** — English and Norwegian Bokmål today. Also available from
the header, wherever you are.

Time and date format are **separate from language**, because the clock your
locale implies is not always the clock you want:

| Setting | Options                               |
| ------- | ------------------------------------- |
| Time    | Match language, 24-hour, or 12-hour   |
| Date    | Match language, or ISO (`YYYY-MM-DD`) |

Both show a live example, and both apply everywhere Alabaster prints a time —
timestamps, file dates, history, and the console.

## Appearance

**Mode** — Light, Dark, or System. Independent of the theme pack.

**Theme pack** — the semantic colour mapping used throughout. Alabaster ships
today, with complete light and dark modes. Registered packs appear here
automatically. See [Theming](/theming).

**Typeface** — five, applied everywhere Alabaster renders text:

| Typeface        |                                                                  |
| --------------- | ---------------------------------------------------------------- |
| Source Code Pro | The default. Monospace, with the widest weight range.            |
| Roboto Mono     |                                                                  |
| Overpass Mono   |                                                                  |
| Public Sans     | The proportional option.                                         |
| OpenDyslexic    | Dyslexia-friendly, and an explicit choice rather than a default. |

Each option in the picker is rendered in its own typeface, so you are choosing by
looking at it rather than by name.

**Text weight** — Light through Bold. A workshop screen read from two metres and
a phone at arm's length are not the same problem.

**Console typeface and weight** are chosen separately, and can be set to match
the interface. They apply to the console transcript, its prompt, and its command
history, on both the dashboard card and the Console page.

## Display

**Keep the screen awake while this tab is open.** For a shop-floor screen or a
tablet watching a print.

Two limits, both stated on the page rather than left to be discovered:

- It only holds **while the tab is in front**. Switching away or letting the
  screen lock releases it until you come back. No web API can do otherwise.
- It needs a **secure context**, so it is unavailable over a plain LAN address.
  It works at `localhost`, or when Alabaster is served over HTTPS.

## Confirmations

Every confirmation dialog in Alabaster, in one place, grouped by area — Power,
Bed mesh, Configuration, History, Machine, Printers, Timelapse, and Maintenance.

Checking a box skips that one dialog from now on. Seventeen of them, including:

- Emergency stop, reboot host, shut down host
- Delete a mesh profile
- Discard changes to a file, save all, discard all, save all and restart
- Delete a file or folder, open an unsupported or large file, create a missing
  include file
- Delete a job from history, reprint a job
- Install an update
- Remove a saved printer
- Delete a timelapse video

One switch on this page runs the other way, and sits in its own section for that
reason: **Ask before starting a print while a maintenance interval is overdue**
adds a prompt rather than removing one, and is off until you turn it on. It
interrupts starting a print, so it needed an explicit yes rather than shipping on
for everyone.

**Skip all confirmation dialogs** overrides the lot. When it is on, the individual
settings say plainly that they are being overridden rather than appearing to have
stopped working.

::: info These are about you, not a printer
Confirmation settings are shared across every printer. So is your language, time
format, theme, and typeface. Dashboards, presets, macros, and maintenance
intervals are per printer.
:::

## Where preferences are stored

In your browser's local storage, on the device you are using. Nothing is written
to the printer.

Another browser or another device starts fresh. Storing settings in Moonraker's
database, so every device sees the same setup, is designed and not yet built —
see [Project status](/guide/status).

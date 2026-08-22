# Settings

Nine categories, chosen from a rail that stays put while you scroll. Pick one
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

## Editor

**Indent width** — 2, 4, or 8 spaces — for the
[configuration editor](/interface/configuration): what <kbd>Tab</kbd> inserts,
and how far a new line is carried in when it continues a property such as a
macro's G-code.

It inserts spaces rather than a tab character, so a file you edit here reads at
the same width wherever it is opened next. Indentation already in a file is left
exactly as it is — tabs included, though they are displayed at this width too.

## Confirmations

Every confirmation dialog in Alabaster, in one place, grouped by area — Power,
Interrupting an active print, Bed mesh, Console, Configuration, History,
Machine, Printers, Accounts, G-code viewer, Timelapse, and Backup and sync.

Checking a box skips that one dialog from now on. Twenty-eight of them, and
this is all of them:

- Emergency stop, reboot host, shut down host
- Restart Klipper, firmware restart, clear the job queue, exclude an object
- Delete a mesh profile
- Clear the console, clear command history
- Discard changes to a file, save all, discard all, save all and restart
- Delete a file or folder, open an unsupported file, create a missing include
  file
- Delete a job from history, reprint a job
- Install an update
- Remove a saved printer
- Delete a user, regenerate the API key
- Open a large G-code file
- Delete a timelapse video
- Import settings, reset settings, forget synced data

**Interrupting an active print** carries a switch for the whole group, because
the decision behind those four is one decision — do I want to be asked before
something ends the job I am running — rather than four. They ask only while a
job is loaded; with nothing running, each is an ordinary action and goes ahead
without a word.

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

## Backup and sync

Save every setting above, and this printer's dashboard layout, to a file —
restore from one, or reset everything back to how Alabaster starts out.

- **Export** writes a file you can keep or carry to another device.
- **Import** replaces your current theme, language, format, confirmation, and
  dashboard-layout settings with whatever the file contains. It asks first, and
  a file it cannot read as an Alabaster backup is said so rather than silently
  ignored.
- **Reset to defaults** returns the same set to their starting values. The
  printers you have added, and any logins, are untouched.

### Sync to this printer

**Sync settings and layout to this printer** keeps that same set in the
printer's own Moonraker database, so it follows you back here from another
browser or another device.

It is **off by default and enabled per printer** — turning it on for the machine
in the workshop does not turn it on for the one in the office. The card shows
when it last synced, or that it has not yet, and **Sync now** pushes on demand.

Where the printer requires a login, each account gets its own synced copy, so
two people sharing a printer do not overwrite each other's setup.

**Forget synced data** removes what is stored in that printer's database.
Nothing in your browser changes — this clears the printer's copy, not yours.

## Where preferences are stored

In your browser's local storage, on the device you are using. With sync off —
which is how it starts — nothing is written to the printer, and another browser
or another device starts fresh.

Some things stay browser-local even with sync on, because carrying them to
another screen would be wrong rather than helpful:

- **The printer list itself.** See
  [Several printers](/guide/printers#where-it-is-all-stored).
- **Device ergonomics** — the screen-awake setting, whether the sidebar is
  collapsed, and which settings category you last had open.
- **Logins and sessions**, which belong to the device you are on.

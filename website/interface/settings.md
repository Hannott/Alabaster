# Settings

Settings holds the options for connecting to your printer and configuring
Alabaster, organized into ten categories chosen from a rail that stays visible
while you scroll. Select a category to show only that card, or select **Show
all settings** to show every card again.

Alabaster remembers your last choice, so it stays selected when you leave the
page and come back.

## Printer service

This card manages the Moonraker connection for the printer you are on.

Enter a hostname, an HTTP address, or a complete WebSocket address, then select
**Save and connect**. Alabaster adds the `/websocket` path if it is missing.

The status shows one of: Disconnected, Connecting, Starting session,
Connected, or Reconnecting. If the connection fails, the status names the
failure: no response, or a response that refused the connection.

See [Connecting to Moonraker](/guide/connecting) for the address formats and
the CORS setup.

## Printers

This card lists every printer you have saved and shows which one is active.

Add a printer with its address and an optional name. When adding a printer,
you can select **copy the dashboard from a printer you already set up** to
copy its layout, modules, and module configuration.

Rename or remove any saved printer. Removing a printer does not delete its
configuration: add the printer back and its dashboard returns.

See [Several printers](/guide/printers) for more information, including why
settings follow a printer's identity rather than its address.

## Cameras

This card lists every camera the printer knows about. Cameras live in
Moonraker's own webcam database, not in Alabaster. Mainsail or Fluidd running
on the same printer sees any camera you add or change here, and a camera
either of them added appears here as soon as you open this card.

Select **Add a camera** to add one. Set its name, its stream, and how it
draws: rotation, flip, target frame rate, and a crosshair with its own colour
and size. The fields shown depend on the streaming service you choose, so you
only see controls that apply. A live preview appears beside the form while you
set it up.

Toggle a camera on or off from its row. Every Camera dashboard module respects
this switch. A camera declared directly in `moonraker.conf` is shown but not
editable, because Moonraker does not allow changing it.

A dashboard card's own settings set which cameras it shows and in what
arrangement. See [Camera](/interface/modules#camera).

## Users

This category appears only when the printer you are on requires a login.
Without a login configured, Alabaster treats your network as trusted.

If your printer requires a login, log in with a username and password.
Alabaster remembers the session on this device, so you normally only need to
log in once.

Once logged in, you can:

- **Change your password.**
- **Add another user.** This logs this device in as the account you just
  created. Log back in as yourself to keep managing the printer under your
  own account.
- **Remove another user's account.** You cannot remove your own account;
  Moonraker requires a different logged-in account to do that.
- **See, copy, and regenerate the API key.** Other Moonraker clients, such as
  a mobile app or a script, use this key to connect without logging in
  interactively.

See [Connecting to Moonraker](/guide/connecting#logging-in) for how a printer
comes to require a login, and how this differs from the CORS trust you set up
for a printer on another host.

## Language and format

**Interface language**: English and Norwegian Bokmål. You can also change
the language from the header, on any page.

Time and date format are set separately from language:

| Setting | Options                               |
| ------- | ------------------------------------- |
| Time    | Match language, 24-hour, or 12-hour   |
| Date    | Match language, or ISO (`YYYY-MM-DD`) |

Both settings show a live example. Both apply everywhere Alabaster displays a
time: timestamps, file dates, history, and the console.

## Appearance

**Mode**: Light, Dark, or System. Independent of the theme pack.

**Theme pack**: the semantic colour mapping used throughout the interface.
The built-in pack has complete light and dark modes. Registered packs appear
here automatically. See [Theming](/theming).

**Typeface**: five typefaces, used everywhere Alabaster renders text:

| Typeface        |                                                                  |
| --------------- | ---------------------------------------------------------------- |
| Source Code Pro | The default. Monospace, with the widest weight range.            |
| Roboto Mono     |                                                                  |
| Overpass Mono   |                                                                  |
| Public Sans     | The proportional option.                                         |
| OpenDyslexic    | Dyslexia-friendly, and an explicit choice rather than a default. |

Each option in the picker renders in its own typeface, letting you compare
them directly.

**Text weight**: Light through Bold. Use a heavier weight for a screen viewed
from a distance, and a lighter weight for a screen viewed up close.

**Console typeface and weight** are set separately, and can be set to match
the interface. They apply to the console transcript, its prompt, and its
command history, on both the dashboard card and the Console page.

**Page headers**: Show or hide every page's title row. Hiding it pulls each
page's content up under the header. A page with its own action (Timelapse's
refresh, Dashboard's customize) moves that action into a button in the
bottom-right corner; opening it reveals the action rather than losing it.

**Minimalistic sidebar**: Removes the Alabaster mark and name from the
sidebar and collapses it to icons only. You can still expand it from its
collapse button; only the mark and name stay hidden.

## Display

**Keep the screen awake while this tab is open.** Use this for a shop-floor
screen or a tablet monitoring a print.

This setting has two limits:

- It only holds while the tab is in front. Switching to another tab or
  letting the screen lock releases it until you return. No web API can hold
  the screen awake while a tab is in the background.
- It needs a secure context, so it is unavailable over a plain LAN address.
  It works at `localhost`, or when Alabaster is served over HTTPS.

## Editor

**Indent width**: 2, 4, or 8 spaces. This sets what <kbd>Tab</kbd> inserts in
the [configuration editor](/interface/configuration), and how far a new line
indents when it continues a property such as a macro's G-code.

The editor inserts spaces, not a tab character, so a file you edit here reads
at the same width wherever it is opened next. Indentation already in a file is
left as it is, including tabs, though tabs are displayed at this width too.

## Confirmations

This card lists every confirmation dialog in Alabaster, grouped by area:
Power, Interrupting an active print, Bed mesh, Console, Configuration,
History, Machine, Cameras, Printers, Accounts, G-code viewer, Timelapse, and
Backup and sync.

Check a box to skip that dialog from now on. There are thirty-two
confirmations in total:

- Emergency stop, reboot host, shut down host
- Restart Klipper, firmware restart, clear the job queue, exclude an object
- Delete a mesh profile
- Clear the console, clear command history
- Discard changes to a file, save all, discard all, save all and restart
- Delete a file or folder, open an unsupported file, create a missing include
  file
- Delete a job from history, reprint a job
- Install an update, roll back an installed update, stop a service, restart a
  service
- Remove a camera
- Remove a saved printer
- Delete a user, regenerate the API key
- Open a large G-code file
- Delete a timelapse video
- Import settings, reset settings, forget synced data

**Interrupting an active print** has one switch for the whole group, because
the four dialogs it covers share one decision: whether to be asked before
something ends the running job. These dialogs appear only while a job is
loaded. With nothing running, each action goes ahead without a prompt.

One switch on this page works the other way and has its own section: **Ask
before starting a print while a maintenance interval is overdue** adds a
prompt instead of removing one, and is off by default.

**Skip all confirmation dialogs** overrides every setting on this card. When
it is on, each individual setting shows that it is being overridden, instead
of silently appearing to stop working.

**Dashboard modules** lists every confirmation that belongs to a card
instead: Print's start, pause, and cancel; Movement's motors off and bed
leveling; Temperatures' heater calibration; Bed mesh's delete profile. Each of
these also has its own checkbox on the card's own settings, right beside the
action it guards; checking either box changes the same setting.

::: info Shared across all printers
Confirmation settings apply to you, not to a printer. The same is true for
your language, time format, theme, and typeface. Dashboards, presets, macros,
and maintenance intervals are set per printer.
:::

## Backup and sync

This card saves every setting above, plus this printer's dashboard layout, to
a file. You can restore from that file, or reset everything to how Alabaster
starts out.

- **Export** writes a file you can keep or carry to another device.
- **Import** replaces your current theme, language, format, confirmation, and
  dashboard-layout settings with the contents of a file. It asks for
  confirmation first. If the file is not a valid Alabaster backup, Alabaster
  tells you so.
- **Reset to defaults** returns the same settings to their starting values.
  Printers you have added, and any logins, are not affected.

### Sync to this printer

**Sync settings and layout to this printer** stores the same settings in the
printer's own Moonraker database, so they follow you back to this printer
from another browser or device.

This setting is off by default and enabled per printer. Turning it on for one
printer does not turn it on for another. The card shows when it last synced,
or that it has not yet synced, and **Sync now** syncs on demand.

If the printer requires a login, each account gets its own synced copy, so
two people sharing a printer do not overwrite each other's settings.

**Forget synced data** removes the settings stored in that printer's
database. It does not change anything in your browser; it clears only the
printer's copy.

## Where preferences are stored

Alabaster stores preferences in your browser's local storage, on the device
you are using. Sync is off by default, so nothing is written to the printer,
and another browser or device starts with default settings.

Some settings stay browser-local even with sync on, because they apply to
this device only:

- **The printer list itself.** See
  [Several printers](/guide/printers#where-it-is-all-stored).
- **Device ergonomics**: the screen-awake setting, whether the sidebar is
  collapsed, and which settings category you last had open.
- **Logins and sessions**, which belong to the device you are on.

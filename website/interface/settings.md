# Settings

Settings holds the options for connecting to your printer and configuring
Alabaster, organized into eleven categories chosen from a rail that stays visible
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

**Show pages this printer has not set up** puts every page in the navigation,
including ones a printer cannot fill yet, such as Timelapse without the
timelapse component. Useful for seeing what a page offers before you install
what it needs.

See [Several printers](/guide/printers) for more information, including why
settings follow a printer's identity rather than its address.

### Z motion

Sets which part moves when Z changes, the nozzle or the bed, and which way
Z+ moves it. Klipper cannot report either, and the Movement card uses both
to lay out its Z buttons, Z slider, and Z offset steps.

Most printers put Z 0 where the nozzle meets the bed, so choosing the part
also picks the usual direction. Change **Z+ direction** for a printer that
homes Z to the far end of its travel, such as a bed that Z+ raises toward
the nozzle.

The choice is saved per printer and included in backup and sync. It does
not appear for a delta printer, where only the nozzle moves.

## Cameras

This card lists every camera the printer knows about. Cameras live in
Moonraker's own webcam database, not in Alabaster. Mainsail or Fluidd running
on the same printer sees any camera you add or change here, and a camera
either of them added appears here as soon as you open this card.

Select **Add a camera** to add one. Set its name, its stream, and how it
draws: rotation, flip, target frame rate, and a crosshair with its own color
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

**Theme pack**: the semantic color mapping used throughout the interface.
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

**Documentation**: which site the editor menu's reference links open, for the
printer you are connected to. **Match the firmware** follows the firmware
Moonraker's update manager reports and names the one it found. Choose Klipper
or Kalico when the update manager does not manage the firmware.

## Commands

Keep jogging, extruding, running macros, and changing values while the
printer is busy. With
**Queue each press**, the default, every press is sent straight away and the
printer runs them in order as soon as it is free, so five Z steps pressed
during a heat-up all happen once it finishes. A command is never reported as
failed just because it had to wait.

Choose **Wait for the printer** to have a button stay disabled until the
printer has accepted its previous command instead.

Either way, homing, calibration steps, and starting or stopping a print are
sent one at a time. Home stays disabled until the machine has finished moving.

**Show queued commands in the header** adds a button, while queueing, that
appears when a command has had to wait. It lists the commands this browser
has sent that the printer has not run yet, in the order it will run them,
with where each came from and how long it has waited. A queued command
cannot be withdrawn; the emergency stop clears them all.

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

### Your profile on the printer

Log in to a Moonraker account and your settings and dashboard layout follow
you: they are saved to your account's profile in the printer's own
database, and every browser where you log in to that printer picks them up.
Each account has its own profile, so two people sharing a printer do not
overwrite each other's settings. The first time you log in on a printer, your
profile starts from the settings in the browser you are using.

Without a login, nothing is saved to the printer. Each browser keeps its own
settings, so a screen at the printer and a computer elsewhere can be set up
differently.

The card shows when your profile last synced, and **Sync now** syncs on
demand. **Forget synced data** removes your profile from the printer's
database without changing anything in your browser.

## Where preferences are stored

Alabaster keeps every preference in your browser's local storage, and
mirrors it to your profile on the printer while you are logged in.

Some settings stay in the browser even then, because they are about the
screen rather than about you:

- **The printer list itself**, and what depends on it: hidden navigation
  destinations, whether pages a printer has not set up are shown, and the Farm
  view's camera choices. See
  [Several printers](/guide/printers#where-it-is-all-stored).
- **Device ergonomics**: the screen-awake setting, whether the sidebar is
  collapsed or minimal, whether page headers are shown, which settings
  category you last had open, and the Configuration page's hidden file list,
  collapsed tab rows, and full-screen editor.
- **Logins and sessions**, which belong to the device you are on.

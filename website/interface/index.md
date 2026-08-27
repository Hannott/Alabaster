# The interface

Alabaster is a dashboard plus nine focused pages. This section covers each of
them.

## Pages

| Page                                      | What it is for                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| [Dashboard](/interface/overview)          | Everything you watch and touch while a print runs, in cards you arrange.         |
| [Print files](/interface/print-files)     | Browsing what is on the printer, with previews and slicer data, and starting it. |
| [Calibration](/interface/calibration)     | Bed mesh profiles, live probing, endstops, and input-shaper results.             |
| [History](/interface/history)             | Lifetime totals, statistics over a period, and every completed job.              |
| [Timelapse](/interface/timelapse)         | Rendered videos from finished prints.                                            |
| [Configuration](/interface/configuration) | A real editor for `printer.cfg` and everything it includes.                      |
| [Machine](/interface/machine)             | Host load, controller modules, peripherals, services, and software updates.      |
| [G-code viewer](/interface/gcode-viewer)  | Toolpath inspection, live following, and simulation.                             |
| [Console](/interface/console)             | Talking to Klipper directly, and looking up what it can do.                      |
| [Settings](/interface/settings)           | Connection, printers, language, appearance, and confirmations.                   |

A page is hidden entirely when your Moonraker setup does not support it,
rather than shown empty. See
[Which needs what](/guide/faq#a-page-i-expect-is-missing-from-the-navigation)
for details.

## The header

The header appears on every page. It holds what you need from any page.

| Control           | What it does                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Printer           | Switches between saved printers, and opens printer management.                                                     |
| Connection status | The one global status indicator. Ready, printing, paused, needs attention, or not connected.                       |
| Notifications     | Configuration problems, recent printer activity, and Moonraker's own announcements.                                |
| Power and service | Restart Klipper, firmware restart, restart Moonraker, reboot or shut down the host, and any device power switches. |
| Emergency stop    | Shuts down heaters and motion immediately. Asks first, unless you have turned that off.                            |

**Save new config** appears in the header when Klipper is holding changes. It
summarises what the changes are.

A component Moonraker could not load at startup shows at the top of
Notifications, ahead of announcements and recent activity. An example is a
sensor that references an `[mqtt]` section nobody configured. The
notification bell fills in once there is something to see, and animates
until you open the menu. Moonraker cannot acknowledge this kind of error on
its own, so each one can be silenced until the next reboot, or for good.
Fixing the underlying config still requires a Moonraker restart either way.

## Navigation

On desktop, navigation is a sidebar that collapses to icons. On a phone, it
is a bottom bar with four destinations: Overview, Console, Print files, and
History. Everything else, including Configuration and Machine, sits behind
an overflow menu.

Unsaved configuration edits are flagged on the navigation itself, no matter
which page you are on. An edit is never lost without your knowledge.

## What is true everywhere

- **It doesn't reload for a restart.** Restarts are handled in place. Values
  dim while stale and crossfade back. The one exception is updating Alabaster
  itself, which reloads the page once you close the update transcript. See
  [Losing and regaining the connection](/guide/connecting#losing-and-regaining-the-connection)
  for details.
- **No browser dialogs.** `window.confirm`, `window.prompt`, and
  `window.alert` are never used. Every confirmation is a dialog that names
  what it will touch, and each one can be turned off individually in
  [Settings](/interface/settings#confirmations).
- **Status is never colour alone.** Anything a colour says is also said in
  text or a distinct shape.
- **Every string is translated**, including accessible names, titles,
  placeholders, and validation text.
- **Verified narrow.** Every page is checked at desktop width and at 390 px.
  Neither the page nor a toolbar scrolls sideways.

See [Accessibility](/accessibility) for more on these guarantees and the
tests behind them.

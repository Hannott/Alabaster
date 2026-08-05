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

A page that needs something your Moonraker does not have is not shown at all
rather than shown empty. [Which needs what](/guide/faq#a-page-i-expect-is-missing-from-the-navigation).

## The header

The header is on every page and holds what you might need from any of them.

| Control           | What it does                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Printer           | Switches between saved printers, and opens printer management.                                                     |
| Connection status | The one global status indicator. Ready, printing, paused, needs attention, or not connected.                       |
| Notifications     | Recent printer activity, and Moonraker's own announcements.                                                        |
| Power and service | Restart Klipper, firmware restart, restart Moonraker, reboot or shut down the host, and any device power switches. |
| Theme             | Light and dark, without going to Settings.                                                                         |
| Language          | Switch language from wherever you are.                                                                             |
| Emergency stop    | Shuts down heaters and motion immediately. Asks first, unless you have turned that off.                            |

**Save new config** appears here when Klipper is holding changes, summarising what
they are.

## Navigation

On the desktop, a sidebar that collapses to icons. On a phone, a bottom bar with
the four destinations worth a permanent slot — Overview, Print files,
Configuration, Machine — and everything else behind an overflow menu.

Unsaved configuration edits are flagged on the navigation itself, from whatever
page you are on, so an edit left somewhere you are not looking is never lost
quietly.

## What is true everywhere

- **Nothing reloads.** Restarts are handled in place; values dim while stale and
  crossfade back. [How it behaves](/guide/connecting#losing-and-regaining-the-connection).
- **No browser dialogs.** `window.confirm`, `window.prompt`, and `window.alert`
  appear nowhere. Every confirmation is a real dialog that names what it will
  touch, and every one of them can be turned off individually in
  [Settings](/interface/settings#confirmations).
- **Status is never colour alone.** Anything a colour says is also said in text or
  a distinct shape.
- **Every string is translated**, including accessible names, titles,
  placeholders, and validation text.
- **Verified narrow.** Every page is checked at desktop width and at 390 px, and
  neither the page nor a toolbar may scroll sideways.

More on the guarantees, and the tests behind them, in
[Accessibility](/accessibility).

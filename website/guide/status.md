# Project status

Alabaster is an early-stage project, and it is fully released. Versioned
builds are published from tags. It runs daily against real printers,
including a published release installed the documented way.

This page states the current, accurate status of the project. It is kept
current with the code.

## Pages

| Page                                      | State                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Dashboard](/interface/overview)          | Complete. Fifteen modules, three layout profiles, presets.                                                                     |
| [Print files](/interface/print-files)     | Complete. Browsing, previews, metadata, upload, print, queue, accurate estimates.                                              |
| [Calibration](/interface/calibration)     | Complete. Live probe map, endstops, probe accuracy, filament sensors, mesh profiles, graphs.                                   |
| [History](/interface/history)             | Complete. Lifetime totals, statistics window, trend and distribution charts, job list.                                         |
| [Timelapse](/interface/timelapse)         | Complete. Appears only with the timelapse component installed.                                                                 |
| [Configuration](/interface/configuration) | Complete. Editor, include navigation, search, uploads, drag and drop.                                                          |
| [Machine](/interface/machine)             | Complete. Host telemetry, controller modules, peripherals, service start/stop/restart, updates, rollback, repository recovery. |
| [G-code viewer](/interface/gcode-viewer)  | Complete. Streaming parse, live follow, simulation, adaptive quality.                                                          |
| [Console](/interface/console)             | Complete. Transcript, filters, command browser, completion.                                                                    |
| [Settings](/interface/settings)           | Complete. Ten categories, backup and restore, opt-in sync to a printer's database.                                             |

## Dashboard modules

All fifteen modules are shipped: Print, Camera, Temperatures, Movement,
Controls, Machine, Macros, Extruder, Spool, Sensors, Bed mesh, Job queue,
Console, Activity, and Maintenance.

Spool needs Moonraker's Spoolman component. Sensors needs its generic sensor
component. A module hides itself when the printer does not have the
component it needs. Camera and Macros can each appear more than once, with
one card per subject or group.

## Languages and appearance

- **Languages** — English and Norwegian Bokmål. Adding a language only takes a
  translation file, not a code change.
- **Theme packs** — One pack, Alabaster, with independent light and dark modes.
  Adding a second pack only takes one CSS file and a registry line.
- **Typefaces** — Five typefaces, including OpenDyslexic. The console can use
  a separate typeface from the rest of the interface, and text weight is
  adjustable.

## Installation and releases

Built, published, and proven on real hardware.

| Piece                                                                  | State                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Release workflow publishing a versioned `alabaster.zip` with checksums | Done. Tag-triggered, and it runs the full check gate first.                                                                     |
| Installer and uninstaller                                              | Done. Interactive, idempotent, checksum-verified, with a staged swap so an interrupted install rolls back.                      |
| nginx configuration                                                    | Done. Shipped in the archive and written for you.                                                                               |
| Moonraker `update_manager` example using `type: web`                   | Done. The installer offers to add it.                                                                                           |
| Rollback for an interrupted or invalid update                          | Done for installation, and the Machine page can roll back a rollback-eligible update via Moonraker's `machine.update.rollback`. |
| Run on 64-bit Raspberry Pi OS from a published release                 | Done. Installed with the one-line installer and running on a real printer.                                                      |
| Tested on 32-bit Raspberry Pi OS                                       | **Not done.**                                                                                                                   |

The 32-bit row is the remaining gap. The full flow — download, checksum,
install, run — has been tested through a published release on a real 64-bit
printer. The 32-bit case has not been tested on real hardware. There, the
scripts are verified only against a simulated Klipper layout, covering clean
install, re-install, conflict detection, and uninstall.

The one-line installer, described in [Installation](/guide/installation),
fetches the latest published release.

## Macro pack

`alabaster.cfg` ships with Alabaster, and the installer offers to add it. It
provides the pause, resume, cancel, layer-pause, and filament macros described
in [Macros](/guide/macros).

The macro pack is optional. Controls that need it hide themselves on a
printer that does not have it, so nothing breaks for a printer without the
pack.

## Known gaps

- **The printer list does not sync.** Settings and dashboard layout sync when
  you turn sync on for a printer. The printer list itself stays in the
  browser by design: it identifies which databases can be reached, so it
  cannot be stored inside one of them.

## Following along

Development happens on the `develop` branch. `main` carries releases and this
documentation site.

See [Contributing](/contributing) for the setup and the rules that are
enforced.

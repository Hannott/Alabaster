# Project status

Alabaster is early, and it is released. Versioned builds are published from
tags, and it is used daily against real printers — including from a published
release, installed the documented way.

This page is the accurate account. It is kept current with the code.

## Pages

| Page                                      | State                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Dashboard](/interface/overview)          | Complete. Fourteen modules, three layout profiles, presets.                                        |
| [Print files](/interface/print-files)     | Complete. Browsing, previews, metadata, upload, print, queue, accurate estimates.                  |
| [Calibration](/interface/calibration)     | Complete. Live probe map, endstops, probe accuracy, filament sensors, mesh profiles, graphs.       |
| [History](/interface/history)             | Complete. Lifetime totals, statistics window, trend and distribution charts, job list.             |
| [Timelapse](/interface/timelapse)         | Complete. Appears only with the timelapse component installed.                                     |
| [Configuration](/interface/configuration) | Complete. Editor, include navigation, search, uploads, drag and drop.                              |
| [Machine](/interface/machine)             | Complete. Host telemetry, controller modules, peripherals, services, updates, repository recovery. |
| [G-code viewer](/interface/gcode-viewer)  | Complete. Streaming parse, live follow, simulation, adaptive quality.                              |
| [Console](/interface/console)             | Complete. Transcript, filters, command browser, completion.                                        |
| [Settings](/interface/settings)           | Complete. Ten categories, backup and restore, opt-in sync to a printer's database.                 |

## Dashboard modules

All fourteen are shipped: Print, Camera, Temperatures, Movement, Controls,
Machine, Macros, Extruder, Spool, Bed mesh, Job queue, Console, Activity, and
Maintenance.

Spool needs Moonraker's Spoolman component and hides itself without it. Camera
and Macros can each appear more than once, one card per subject or group.

## Languages and appearance

- **Languages** — English and Norwegian Bokmål. A new language is a translation
  file, not a code change.
- **Theme packs** — one, Alabaster, with independent light and dark modes. A
  second is one CSS file and a registry line.
- **Typefaces** — five, including OpenDyslexic, with a separate choice for the
  console and a text-weight setting.

## Installation and releases

Built, published, and proven on real hardware.

| Piece                                                                  | State                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Release workflow publishing a versioned `alabaster.zip` with checksums | Done. Tag-triggered, and it runs the full check gate first.                                                |
| Installer and uninstaller                                              | Done. Interactive, idempotent, checksum-verified, with a staged swap so an interrupted install rolls back. |
| nginx configuration                                                    | Done. Shipped in the archive and written for you.                                                          |
| Moonraker `update_manager` example using `type: web`                   | Done. The installer offers to add it.                                                                      |
| Rollback for an interrupted or invalid update                          | Done for installation. Moonraker owns updates after that.                                                  |
| Run on 64-bit Raspberry Pi OS from a published release                 | Done. Installed with the one-line installer and running on a real printer.                                 |
| Tested on 32-bit Raspberry Pi OS                                       | **Not done.**                                                                                              |

That last row is the remaining gap, and it is narrower than it was. The whole
flow — download, checksum, install, run — has been through a published release
onto a real 64-bit printer. What is left is the 32-bit case, which nobody has
exercised on hardware; the scripts are verified there only against a simulated
Klipper layout, covering clean install, re-install, conflict detection, and
uninstall.

The one-line install in [Installation](/guide/installation) works today and
fetches the latest published release.

## Macro pack

`alabaster.cfg` ships and is offered by the installer. It provides the pause,
resume, cancel, layer-pause, and filament macros described in
[Macros](/guide/macros).

It is optional by design: the controls that need it hide themselves on a printer
that does not have it, so nothing regresses for someone who declines.

## Deliberately not done

These are decisions, not gaps.

**Generic sensors.** Moonraker's `server.sensors.*` endpoints are unused. They
matter only for printers configuring sensors beyond heaters, and will be added
when someone needs them.

**Update rollback and service start/stop.** Moonraker exposes both. Neither is
wired up yet.

## Known gaps

- **The printer list does not sync.** Settings and dashboard layout now do, when
  you turn sync on for a printer. The list of printers itself stays in the
  browser by design — it is the answer to which databases can be reached, so it
  cannot live in one of them.
- **No CAN bus peripheral listing.** Serial and USB devices are listed; CAN
  needs an interface name up front and was left for whoever actually needs it.

## Following along

Development happens on the `develop` branch. `main` carries releases and this
documentation site.

[Contributing](/contributing) covers the setup and the rules that are enforced.

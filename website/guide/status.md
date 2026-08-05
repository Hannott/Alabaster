# Project status

Alabaster is pre-release. It is used daily against real printers, and it has no
published release yet.

This page is the accurate account. It is kept current with the code.

## Pages

| Page                                      | State                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Dashboard](/interface/overview)          | Complete. Fourteen modules, three layout profiles, presets.                                        |
| [Print files](/interface/print-files)     | Complete. Browsing, previews, metadata, upload, print, queue, accurate estimates.                  |
| [Calibration](/interface/calibration)     | Complete. Live probe map, endstops, mesh profiles, input-shaper graphs.                            |
| [History](/interface/history)             | Complete. Lifetime totals, statistics window, trend and distribution charts, job list.             |
| [Timelapse](/interface/timelapse)         | Complete. Appears only with the timelapse component installed.                                     |
| [Configuration](/interface/configuration) | Complete. Editor, include navigation, search, uploads, drag and drop.                              |
| [Machine](/interface/machine)             | Complete. Host telemetry, controller modules, peripherals, services, updates, repository recovery. |
| [G-code viewer](/interface/gcode-viewer)  | Complete. Streaming parse, live follow, simulation, adaptive quality.                              |
| [Console](/interface/console)             | Complete. Transcript, filters, command browser, completion.                                        |
| [Settings](/interface/settings)           | Complete except for cross-device sync.                                                             |

## Dashboard modules

All fourteen are shipped: Print, Camera, Temperatures, Movement, Controls,
Machine, Macros, Extruder, Spool, Bed mesh, Job queue, Console, Activity, and
Maintenance.

Spool needs Moonraker's Spoolman component and hides itself without it. Macros
can appear more than once, one card per group.

## Languages and appearance

- **Languages** — English and Norwegian Bokmål. A new language is a translation
  file, not a code change.
- **Theme packs** — one, Alabaster, with independent light and dark modes. A
  second is one CSS file and a registry line.
- **Typefaces** — five, including OpenDyslexic, with a separate choice for the
  console and a text-weight setting.

## Installation and releases

Built, and not yet proven on real hardware.

| Piece                                                                  | State                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Release workflow publishing a versioned `alabaster.zip` with checksums | Done. Tag-triggered, and it runs the full check gate first.                                                |
| Installer and uninstaller                                              | Done. Interactive, idempotent, checksum-verified, with a staged swap so an interrupted install rolls back. |
| nginx configuration                                                    | Done. Shipped in the archive and written for you.                                                          |
| Moonraker `update_manager` example using `type: web`                   | Done. The installer offers to add it.                                                                      |
| Rollback for an interrupted or invalid update                          | Done for installation. Moonraker owns updates after that.                                                  |
| Tested on 32-bit and 64-bit Raspberry Pi OS                            | **Not done.**                                                                                              |

That last row is the real remaining gap. The scripts are verified against a
simulated Klipper layout — clean install, re-install, conflict detection, and
uninstall — but nobody has yet run the whole flow on a real printer from a
published release.

There is also **no published release yet**, so the one-line install has nothing
to download until the first tag.

## Macro pack

`alabaster.cfg` ships and is offered by the installer. It provides the pause,
resume, cancel, layer-pause, and filament macros described in
[Macros](/guide/macros).

It is optional by design: the controls that need it hide themselves on a printer
that does not have it, so nothing regresses for someone who declines.

## Deliberately not done

These are decisions, not gaps.

**HTTPS.** A page on `https://` cannot open a `ws://` socket, so an HTTPS host
would need TLS on every Moonraker. [The reasoning is
here](/guide/installation#why-http-and-not-https).

**Generic sensors.** Moonraker's `server.sensors.*` endpoints are unused. They
matter only for printers configuring sensors beyond heaters, and will be added
when someone needs them.

**Update rollback and service start/stop.** Moonraker exposes both. Neither is
wired up yet.

## Known gaps

- **Settings do not sync between devices.** Everything is in the browser's local
  storage. Storing it in Moonraker's database is designed and not built.
- **One camera.** The Camera module shows the first enabled webcam Moonraker
  returns. Multiple camera selection is not there yet.
- **No CAN bus peripheral listing.** Serial and USB devices are listed; CAN
  needs an interface name up front and was left for whoever actually needs it.

## Following along

Development happens on the `develop` branch. `main` carries releases and this
documentation site.

[Contributing](/contributing) covers the setup and the rules that are enforced.

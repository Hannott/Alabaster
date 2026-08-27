# Introduction

Alabaster is a web interface for Klipper 3D printers. It runs in your
browser, connects to Moonraker, and needs nothing installed on the device you
use to view it.

It is a static site. No Alabaster process runs on your printer, there is no
database, and there is no account. Point it at Moonraker and it works.

## What you can do with it

- **Run prints.** Browse files with their slicer previews, start them, pause at a
  chosen layer, exclude an object mid-print, and queue what comes next.
- **Drive the machine.** Home, jog, set temperatures, run macros, control fans
  and output pins, and adjust speed, flow, and Z offset while a job runs.
- **Tune it.** Calibrate the bed mesh and read it as a height map, run PID or MPC
  calibration, check bed screws, set pressure advance, and read your input-shaper
  graphs.
- **Keep track of the printer's real numbers.** Lifetime totals, per-period
  statistics, and service intervals measured against them.
- **Edit its configuration.** A real editor with syntax highlighting, include
  navigation, and unsaved-change tracking that never loses an edit.
- **Look after the host.** Live CPU, memory, temperature, and network figures,
  attached peripherals, service state, and software updates.

## How it behaves

Alabaster follows three rules on every screen.

**It doesn't reload for a restart.** Restarting Klipper, Moonraker, or the
firmware does not move the page. Values that go stale dim in place and
crossfade back when fresh data arrives. You keep your scroll position, your
open file, and your half-typed command.

Updating Alabaster itself is the one exception: closing the update transcript
afterward reloads the page once, to load the new version.

**It tells you when something failed.** A command interrupted by a disconnect
does not resend automatically when the connection returns. You are told, and
you decide whether to send it again.

**It discovers your printer.** Every heater, temperature sensor, fan, output
pin, and macro comes from what your machine reports. A page that needs a
Moonraker component you do not have installed does not appear.

## Requirements

| You need               | Notes                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Klipper with Moonraker | Any current release.                                                                                                                                                                                                             |
| A modern browser       | Chrome, Edge, Firefox, or Safari, on desktop or mobile.                                                                                                                                                                          |
| WebGL 2                | Needed for the [G-code viewer](/interface/gcode-viewer) and for the map on the [bed mesh module](/interface/modules#bed-mesh). Without it, bed mesh still shows its axis numbers and probed readings, just not the rendered map. |

## Where to go next

- [What makes it different](/guide/highlights): the features that set
  Alabaster apart.
- [Installation](/guide/installation): how to install it on a Raspberry Pi or
  a separate host.
- [Connecting to Moonraker](/guide/connecting): how to point it at a printer.
- [Project status](/guide/status): what runs today.

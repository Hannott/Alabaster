# Introduction

Alabaster is a web interface for Klipper. It runs in your browser, talks to
Moonraker, and needs nothing installed on the machine you are sitting at.

It is a static site. There is no Alabaster process running on your printer, no
database, and no account. Point it at Moonraker and it works.

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

Three things are true of every screen in Alabaster, and they are worth knowing
before anything else.

**It never reloads itself.** Restart Klipper, restart Moonraker, restart the
firmware — the page stays exactly where it is. Values that have gone stale dim in
place and crossfade back when fresh data arrives. You do not lose your scroll
position, your open file, or your half-typed command.

**It tells you when something failed.** A command interrupted by a disconnect is
never quietly replayed when the connection returns. You are told, and you decide
whether to send it again.

**It discovers your printer.** Every heater, temperature sensor, fan, output pin,
and macro comes from what your machine actually reports. Pages that need a
Moonraker component you do not have installed do not appear at all.

## Requirements

| You need               | Notes                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Klipper with Moonraker | Any current release.                                                                                           |
| A modern browser       | Chrome, Edge, Firefox, or Safari, on desktop or mobile.                                                        |
| WebGL 2                | Only for the [G-code viewer](/interface/gcode-viewer). Everything else works without it.                       |
| A trusted network      | Alabaster is served over plain HTTP by design. See [Installation](/guide/installation#why-http-and-not-https). |

## Where to go next

- [What makes it different](/guide/highlights) — the features worth switching for.
- [Installation](/guide/installation) — getting it onto a Raspberry Pi or a
  separate host.
- [Connecting to Moonraker](/guide/connecting) — pointing it at a printer.
- [Project status](/guide/status) — an accurate account of what runs today.

::: info This project is young
Alabaster is early. It is used daily against real printers, and the one-line
installer fetches a published release, but the version numbers are still low and
some paths have only been walked on one machine. [Project
status](/guide/status) says exactly where things stand.
:::

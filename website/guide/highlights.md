# What makes it different

There are good Klipper web interfaces already. This page covers the reasons to
look at another one.

Everything below either does not exist in established Klipper web interfaces,
or exists there in a different form. Each section links to the page that
covers it in full.

## Time-to-temperature for each heater

Every interface shows a temperature and a target. Alabaster also shows **how
long it will take to get there**.

It learns each heater's climb curve from your machine: the real time it takes
to cross every five-degree band on the way up. The estimate accounts for a hot
end that slows down above 200 °C and a bed that takes four minutes for its
last ten degrees.

Alabaster shows three things a bare reading does not:

- **`~4 min`** — when the heater will reach its target.
- **`8°/min`** — the current climb rate.
- **`Not climbing`** — the heater has a target but is not reaching it. This
  can flag a loose thermistor, a failed heater cartridge, or a part fan
  pointed the wrong way, and the warning appears immediately instead of
  leaving you to notice it ten minutes later.

This does not reproduce Klipper's own control model. It works like a
stopwatch, not a simulation, so it stays accurate for PID and MPC alike.

→ [Temperatures](/interface/modules#temperatures)

## Print progress compared to the slicer estimate

Most interfaces show the slicer's remaining-time guess, which counts down one
second per second.

Alabaster compares actual progress to that guess and reports the difference,
for example **`12% behind the slicer estimate`**. You set the threshold that
triggers a warning. You can also choose where the progress estimate comes
from: the slicer's own `M73` output, the position in the file, or filament
consumed, or leave it on the best source available.

It also shows the time of day the print will finish.

→ [Print](/interface/modules#print)

## Maintenance intervals tracked from printer history

Set an interval, for example belt tension every 200 print hours, nozzle every
5000 metres of filament, or lubricate rails every 90 days. Alabaster counts it
against the printer's own lifetime totals from Moonraker's history, not
against a reminder you update yourself.

Starting a print while an interval is overdue asks you first. You can open
Maintenance, start anyway, or wait.

→ [Maintenance](/interface/modules#maintenance)

## Bed mesh view

The bed mesh renders as a height map, not a grid of coloured squares:

- **Ten projections** — perspective, orthographic, isometric, dimetric,
  trimetric, cavalier, cabinet, one-point, two-point, fisheye.
- **Five render styles** — surface, bars, contour lines, terraced, mosaic.
- **A fixed colour scale** as well as a self-scaling one. A fixed scale lets
  you compare two meshes directly; a self-scaling one does not.

Two warnings come from the mesh, and both catch a real problem:

- **Bed range** — the bed varies by more than the amount you called
  acceptable.
- **Probe temperature drift** — the mesh was probed at 60 °C but the bed is
  now targeting 100 °C. A mesh measured cold and used hot is wrong, and
  nothing else reports it.

Calibration plots each point as it is probed, so a run that is going wrong is
visible before it finishes. A scanning probe has no per-point data to plot;
Calibration states this instead of showing an empty grid.

→ [Bed mesh](/interface/modules#bed-mesh) · [Calibration](/interface/calibration)

## printer.cfg with linked includes

Configuration in Alabaster is a linked document, not a plain text box.

- **`[include]` targets are links.** Ctrl+click one to open it.
- **A missing target offers to be created**, along with its folder if that is
  missing too, so you can build a configuration downward from its include
  list.
- **Moving an included file offers to rewrite the include.** Choose move and
  update, move only, or don't move. An include pointing at nothing is enough
  by itself to stop Klipper from starting.
- **Add to printer.cfg** and **Remove from printer.cfg** are on each file's
  own menu, and files already included are marked in the list.

Edits survive everything except a browser reload. Each file keeps its own
buffer for as long as the tab is open, and an unsaved edit is flagged on the
file, on every folder above it, and in the navigation, visible from any page.

→ [Configuration](/interface/configuration)

## G-code viewer for large files

A 100 MB print begins drawing about a quarter of a second in and keeps
filling in while the rest downloads and parses. You can orbit the model
before it finishes loading.

- **Following a live print walks the real moves in the file.** The toolhead
  follows the actual path; corners stay corners instead of sliding between
  telemetry samples and cutting across a curve.
- **Geometry ahead of the print is not drawn**, rather than dimmed, so the
  frontier matches exactly where printing has reached.
- **Simulation mode** replays any slice at up to 20×, with a scrubber,
  with no printer connected.
- **Rendering quality adapts to your device** and reduces detail to keep the
  view responsive. The layer currently printing always draws at full
  precision.
- **Open a local file** without uploading it, to check a slice before
  committing to it.

→ [G-code viewer](/interface/gcode-viewer)

## All confirmations on one page

Confirmations are a personal setting. Most interfaces make you find each one
where it lives, or give you no way to turn them off at all.

Alabaster lists **every confirmation in the application on one page**, grouped
by area, each with its own checkbox. Turn off individual confirmations and
keep the ones you want. A global override turns off all of them, and states
plainly which individual settings it is overriding.

→ [Settings](/interface/settings#confirmations)

## Separate layouts per device

The dashboard keeps **separate layouts for desktop, tablet, and phone**. Card
order, column, width, visibility, and collapsed state are set per viewport. A
card's own configuration is shared across all three: temperature presets set
up on desktop also appear on your phone.

Layouts are scoped to the **printer's identity, not its address**. Moving a
printer to a new hostname, reaching it through a tunnel, or connecting by IP
address instead keeps the same dashboard.

Modules that support it can appear more than once, for example one Macros
card per group. Each card has its own name, colour-coded buttons, and its own
rule for which printer states it appears in.

→ [Customizing the dashboard](/interface/customize)

## Accessibility guarantees

These guarantees are enforced by automated tests that fail the build:

| Guarantee                                                                                                    | Enforced by         |
| ------------------------------------------------------------------------------------------------------------ | ------------------- |
| Every control variant clears 4.5:1 contrast over every surface it can sit on — at rest, hovered, and pressed | a contrast test     |
| Chromatic colour never leaves the Okabe-Ito colour-blind-safe palette                                        | a palette test      |
| Every animation has a reduced-motion fallback                                                                | a motion test       |
| Every clickable control comes from one button system, and none of them move on hover or press                | an interaction test |
| Every locale matches the English schema, with no empty messages                                              | a locale test       |

In addition, **status is never carried by colour alone**, and
`window.confirm`, `window.prompt`, and `window.alert` appear nowhere in the
application. Every confirmation is a real dialog that names what it will
affect.

Alabaster also offers **five typefaces**, including OpenDyslexic, a separate
typeface for the console, and a text-weight setting. This covers both a
workshop screen read from two metres away and a phone held at arm's length.

→ [Accessibility](/accessibility) · [Theming](/theming)

## Additional features

- **Pause at a layer.** Arm a pause at layer 47, or pause when the current
  layer finishes. Useful for colour changes and embedded magnets.
- **Bed plan.** Click a spot on a picture of your bed to send the nozzle
  there.
- **Z offset in micrometres**, with a legend showing which direction is
  closer to the bed, and a direction swap for printers whose bed moves
  instead of the gantry.
- **Command browser.** Search every command your machine reports, with the
  help text Klipper provides. This includes macros you wrote yourself, which
  are not covered by any documentation.
- **Live endstop readout** on Calibration, polled while the printer is idle
  and paused while it prints.
- **A manual probe brings its own prompt.** When Klipper stops to ask where
  the bed is, the prompt reaches you on any page, regardless of what started
  it, and can be dismissed and returned to later without answering it.
- **Input-shaper graphs** read straight from the config folder, so tuning
  results appear in the interface instead of in a folder you have to find
  separately.
- **Peripherals.** Lists the serial, USB, and CAN devices attached to the
  host, so finding the right `/dev/serial/by-id` path or CAN UUID takes a
  page instead of an SSH session.
- **Save new config**, summarised. If Klipper is holding a probe offset, a
  heater model, and a mesh, the summary lists which ones, and it waits for
  the print to finish rather than offering to end it.
- **Repository recovery.** A dirty, invalid, detached, or corrupt update
  source is offered the specific recovery it needs, rather than a single
  generic failure message.
- **Roll back an update.** A git-tracked source, such as Klipper, Moonraker,
  or a git-based client, can be reverted to the version it had before its
  last update. This is guarded the same way an install is.
- **Screen wake lock** for a shop-floor display watching a print.
- **Logs into a printer that requires it.** Hidden on the trusted-LAN setup
  most printers use, and appears when a printer is configured to require a
  login.
- **Time and date format overrides**, independent of language, so you can
  choose a different clock format than the one your locale implies.

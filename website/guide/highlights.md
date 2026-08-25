# What makes it different

There are good Klipper web interfaces already. This page is about the reasons to
look at another one.

Everything below either does not exist in the established Klipper web
interfaces, or exists there in a form that answers a different question. Each is
linked to the page that covers it properly.

## Your printer's heaters, timed by watching them

Every interface shows you a temperature and a target. Alabaster shows you **how
long it will take to get there**.

It learns each heater's climb curve from your machine — the real time taken to
cross every five-degree band on the way up — and answers from that. So the
estimate accounts for a hot end that slows down over 200 °C and a bed that takes
four minutes for its last ten degrees.

You get three things a bare reading does not give you:

- **`~4 min`** — when this heater will actually arrive.
- **`8°/min`** — how fast it is climbing right now.
- **`Not climbing`** — the heater has a target, and it is not getting there. A
  loose thermistor, a failed cartridge, or a part fan pointed the wrong way, said
  out loud instead of left for you to notice ten minutes later.

Nothing here reproduces Klipper's own control model. It is a stopwatch, not a
simulation, which is why it stays right across PID and MPC alike.

→ [Temperatures](/interface/modules#temperatures)

## A print that tells you it is falling behind

The remaining time on most interfaces is the slicer's guess, decaying at one
second per second.

Alabaster compares what is actually happening to that guess and says so:
**`12% behind the slicer estimate`**. You set the threshold that earns a warning.
You also choose where the estimate comes from at all — the slicer's own `M73`
output, the position in the file, or filament consumed — or leave it on the best
source available.

It also shows you the time of day the print finishes, which is the number you
were going to work out yourself anyway.

→ [Print](/interface/modules#print)

## Maintenance measured against the printer, not a calendar you keep

Set an interval — _belt tension every 200 print hours_, _nozzle every 5000 metres
of filament_, _lubricate rails every 90 days_ — and Alabaster counts it against
the printer's own lifetime totals from Moonraker's history. Not against a
reminder you have to keep updating.

The part that matters is what it does with that: **starting a print while an
interval is overdue asks you first.** It offers to open Maintenance, start
anyway, or wait. A reminder you have to go and look at is a reminder you will not
look at.

→ [Maintenance](/interface/modules#maintenance)

## A bed mesh you can actually read

The mesh is a real height map, not a grid of coloured squares:

- **Ten projections** — perspective, orthographic, isometric, dimetric,
  trimetric, cavalier, cabinet, one-point, two-point, fisheye.
- **Five render styles** — surface, bars, contour lines, terraced, mosaic.
- **A fixed colour scale** as well as a self-scaling one, because two meshes read
  against the same scale can be compared and two meshes each scaled to themselves
  cannot. This is the difference between "did my adjustment help" and "here are
  two pictures".

Two warnings come out of it, and both catch a real failure:

- **Bed range** — the bed varies by more than the amount you called acceptable.
- **Probe temperature drift** — _this mesh was probed at 60 °C, the bed is now
  targeting 100 °C_. A mesh measured cold and used hot is wrong, silently, and
  nothing else tells you.

Calibration also **plots the points as they are probed**, so a run that is going
wrong is visible before it finishes. On a scanning probe, which has no per-point
report to follow, it says so rather than showing you an empty grid.

→ [Bed mesh](/interface/modules#bed-mesh) · [Calibration](/interface/calibration)

## printer.cfg as hypertext

Configuration in Alabaster is a linked document, not a text box.

- **`[include]` targets are links.** Ctrl+click one to open it.
- **A missing target offers to be created** — with its folder, if that is missing
  too — so you can build a configuration downward from its include list.
- **Moving an included file offers to rewrite the include.** Move and update,
  just move, or don't move. An include left pointing at nothing is enough on its
  own to stop Klipper from starting.
- **Add to printer.cfg / Remove from printer.cfg** are on the file's own menu,
  and files already included are marked in the list.

Your edits survive everything but a browser reload. Every file gets its own
buffer for as long as the tab is open, and an unsaved edit is flagged on the
file, on every folder above it, and on the navigation itself — from whatever page
you happen to be on.

→ [Configuration](/interface/configuration)

## A G-code viewer that treats big files as the normal case

A 100 MB print begins drawing about a quarter of a second in and keeps filling in
while the rest downloads and parses. You can orbit a model long before it has
finished loading.

- **Following a live print walks the real moves in the file**, so the toolhead
  follows the actual path. Corners stay corners. It does not slide between
  telemetry samples and cut across a curve.
- **Geometry ahead of the print is not drawn at all**, rather than dimmed, so the
  frontier is exactly where printing has reached.
- **Simulation mode** replays any slice at up to 20×, with a scrubber, without a
  printer connected at all.
- **Rendering quality measures your device** and gives up detail to keep the view
  responsive — never on the layer being actively printed, which always draws at
  full precision.
- **Open a local file** without uploading it, to check a slice before you commit
  to it.

→ [G-code viewer](/interface/gcode-viewer)

## Every confirmation dialog in one list

Confirmations are a personal setting, and most interfaces make you find each one
where it lives — or give you nothing at all.

Alabaster lists **every confirmation in the application on a single page**,
grouped by area, each with its own checkbox. Turn off the ones you are tired of
and keep the ones that save you. There is a global override when you want none of
them, and it says plainly which individual settings it is overriding.

→ [Settings](/interface/settings#confirmations)

## Three layouts, not one

The dashboard keeps **separate layouts for desktop, tablet, and phone**. Card
order, column, width, visibility, and collapsed state are per viewport. A card's
own configuration is shared across all three, so the temperature presets you set
up on the desktop are the ones on your phone.

Layouts are scoped to the **printer's identity, not its address**. Move a printer
to a new hostname, reach it through a tunnel, or type its IP instead — it is the
same printer, with the dashboard you built for it.

Modules that support it can appear more than once. One Macros card per group,
each with its own name, colour-coded buttons, and its own rule about which
printer states it shows up in.

→ [Customizing the dashboard](/interface/customize)

## Readability treated as a contract

These are tests that fail the build, not guidelines someone tries to follow:

| Guarantee                                                                                                    | Enforced by         |
| ------------------------------------------------------------------------------------------------------------ | ------------------- |
| Every control variant clears 4.5:1 contrast over every surface it can sit on — at rest, hovered, and pressed | a contrast test     |
| Chromatic colour never leaves the Okabe-Ito colour-blind-safe palette                                        | a palette test      |
| Every animation has a reduced-motion fallback                                                                | a motion test       |
| Every clickable control comes from one button system, and none of them move on hover or press                | an interaction test |
| Every locale matches the English schema, with no empty messages                                              | a locale test       |

Alongside them: **status is never carried by colour alone**, and
`window.confirm`, `window.prompt`, and `window.alert` appear nowhere in the
application. Every confirmation is a real dialog that names what it will touch.

You also get **five typefaces** — including OpenDyslexic — a separate typeface
for the console, and a text-weight setting, because a workshop screen read from
two metres away and a phone held at arm's length are not the same problem.

→ [Accessibility](/accessibility) · [Theming](/theming)

## Smaller things that add up

- **Pause at a layer.** Arm a pause at layer 47, or pause when the current layer
  finishes. For colour changes and embedded magnets.
- **Bed plan.** Click a spot on a picture of your bed to send the nozzle there.
- **Z offset in micrometres**, with a legend that says which way is closer to the
  bed, and a direction swap for printers whose bed moves instead of the gantry.
- **Command browser.** Search every command your machine reports, with the help
  text Klipper provides — including the macros you wrote yourself, which no
  documentation covers.
- **Live endstop readout** on Calibration, polled while the printer is idle and
  paused while it prints.
- **A manual probe brings its own prompt.** Klipper stopping to ask where the bed
  is reaches you wherever you are, whatever started it, and can be put aside and
  picked back up without answering it.
- **Input-shaper graphs** read straight out of the config folder, so your tuning
  results are in the interface instead of a folder you have to remember.
- **Peripherals.** The serial and USB devices actually attached to the host, so
  finding the right `/dev/serial/by-id` path is a page rather than an SSH session.
- **Save new config**, summarised. Klipper holding a probe offset, a heater
  model, and a mesh tells you which, and waits for the print to finish rather
  than offering to end it.
- **Repository recovery.** A dirty, invalid, detached, or corrupt update source
  offers the recovery it actually needs instead of failing the same way as
  everything else.
- **Screen wake lock** for a shop-floor display watching a print.
- **Logs into a printer that requires it.** Hidden entirely on the trusted-LAN
  setup most printers use; appears the moment one is configured to require a
  login.
- **Time and date format overrides**, separate from language, because the clock
  your locale implies is not always the clock you want.

## And a few things it does not do

Saying so plainly is part of the pitch.

- It is **early**. Releases are published and the one-line install works — it
  has been run end to end onto a 64-bit Raspberry Pi — but 32-bit Pi OS has not
  been exercised on real hardware yet.

[Project status](/guide/status) is the full account.

# Dashboard

The dashboard is a grid of module cards. It is the page you leave open while a
print runs.

Which cards you get, where they sit, and how wide they are is entirely yours.
[Customizing the dashboard](/interface/customize) covers the arranging;
[Dashboard modules](/interface/modules) covers what each card does.

## What is on it by default

A new printer starts on the **Standard** preset: Print, Camera, Temperatures,
Movement, Controls, Macros, Console, and Activity.

Two other presets are one click away. **Minimal** cuts back to Print, Camera,
Temperatures, and Movement. **Tuning** drops Camera and Activity in favour of
Extruder and Bed mesh.

Applying a preset only changes which cards are visible. It never discards a
card's configuration, so switching to Minimal and back leaves your macro
selections and temperature presets exactly as they were.

## How a card is built

Every card has the same three layers, and knowing which is which saves a lot of
hunting.

**The card itself** carries what you need mid-print — the readings and the
controls you reach for without thinking.

**Quick settings** sit behind the gear in the card's header. These are the few
switches that change what the card shows: turn the temperature chart on, reveal
the Z offset controls, show output pins. They open in place, on the card.

**Full settings** is everything else — presets, step sizes, thresholds, macro
selection. Ctrl+click the gear, or choose **All settings**, and the card docks
beside its own settings pane so you can watch what your changes do.

::: tip Promote what you use
Most modules let you move a setting between the two layers. If you adjust
something weekly, put it on the card; if you set it once, leave it in the full
pane.
:::

## Collapsed cards still say something

Collapse a card and it keeps one value in its header — the one worth watching
when the rest is out of the way:

| Card         | Collapsed reading                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Print        | Progress percentage, while something is printing.                                                   |
| Temperatures | The hot end, or whatever this machine can heat.                                                     |
| Movement     | The Z height, or `Not homed`.                                                                       |
| Controls     | The part fan's speed.                                                                               |
| Extruder     | The extrusion factor, always — this is the value Klipper carries silently from one job to the next. |
| Spool        | Weight left on the active spool.                                                                    |
| Bed mesh     | The mesh range, or `Unloaded`, or `No data`.                                                        |
| Maintenance  | `Overdue`, when anything is.                                                                        |

A card with nothing worth saying stays quiet rather than showing a placeholder.

## Cards that hide themselves

A module that has nothing to work with does not sit there empty:

- **Spool** appears only when Moonraker has Spoolman configured.
- **Camera** says so plainly when no webcam is configured, rather than showing a
  broken frame.
- **Macros** marks a macro your printer no longer defines, and can hide missing
  ones entirely.
- **Macros groups** can be set to show only while the printer is idle, paused, or
  printing — so your pre-print macros are not in the way mid-job.

## While a service is away

Cards dim in place and keep their last-known values, labelled as such. They do
not each grow a status panel — the header carries the one global status.

Anything that sends a command is disabled until it can actually be sent, so a
button that would fail silently is never live.

## Drag a file onto it

Dropping a G-code file from your desktop onto the Print card uploads it and
starts printing it. Dropping one on the Job queue card uploads it and queues it.

Both say what they will do before you let go.

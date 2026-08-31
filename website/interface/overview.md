# Dashboard

The dashboard is a grid of module cards. It is the page you leave open while a
print runs.

You choose which cards appear, where they sit, and how wide they are. See
[Customizing the dashboard](/interface/customize) for arranging cards, and
[Dashboard modules](/interface/modules) for what each card does.

## What is on it by default

A new printer starts on the **Standard** preset: Print, Camera, Temperatures,
Movement, Controls, Macros, Console, and Activity.

Two other presets are available. **Minimal** shows only Print, Camera,
Temperatures, and Movement. **Tuning** replaces Camera and Activity with
Extruder and Bed mesh.

Applying a preset only changes which cards are visible. It does not discard a
card's configuration. Switching to Minimal and back keeps your macro
selections and temperature presets unchanged.

## How a card is built

Every card has the same three layers.

**The card itself** shows the readings and controls you need while a print
runs.

**Quick settings** sit behind the gear icon in the card's header. These are
the few switches that change what the card shows, such as turning on the
temperature chart, revealing the Z offset controls, or showing output pins.
They open in place, on the card.

**Full settings** holds everything else: presets, step sizes, thresholds, and
macro selection. Ctrl+click the gear icon, or choose **All settings**. The
card docks beside its settings pane, showing the effect of each change live.

::: tip Moving settings between layers
Most modules let you move a setting between the two layers. Put a setting you
adjust often on the card. Leave a setting you set once in the full settings
pane.
:::

## Collapsed card values

A collapsed card keeps one value visible in its header:

| Card         | Collapsed reading                                                                           |
| ------------ | ------------------------------------------------------------------------------------------- |
| Print        | Progress percentage, while something is printing.                                           |
| Temperatures | The hot end, or whatever this machine can heat.                                             |
| Movement     | The Z height, or `Not homed`.                                                               |
| Controls     | The part fan's speed.                                                                       |
| Extruder     | The extrusion factor, always. Klipper carries this value silently from one job to the next. |
| Spool        | Weight left on the active spool.                                                            |
| Bed mesh     | The mesh range, or `Unloaded`, or `No data`.                                                |
| Maintenance  | `Overdue`, when anything is.                                                                |

A card with nothing worth showing displays nothing, rather than a
placeholder.

## Cards that hide automatically

A module with nothing to work with does not display an empty card:

- **Spool** appears only when Moonraker has Spoolman configured.
- **Camera** shows a message when no webcam is configured, instead of a
  broken frame.
- **Macros** marks a macro your printer no longer defines, and can hide
  missing ones entirely.
- **Macros groups** can be set to show only while the printer is idle,
  paused, or printing, keeping pre-print macros out of the way during a job.

## When a service is unavailable

Cards dim in place and keep their last-known values, labelled as such. Cards
do not each display their own status panel. The header carries the one
global status.

A control that sends a command is disabled until the command can be sent. A
button that would fail silently is never active.

## Drag and drop uploads

Dropping a G-code file from your desktop onto the Print card uploads it and
starts printing it. Dropping one on the Job queue card uploads it and queues
it.

Both show what they will do before you release the file.

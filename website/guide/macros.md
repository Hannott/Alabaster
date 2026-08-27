# Macros

`alabaster.cfg` is an optional Klipper config file for Alabaster. It provides
the macros some controls call, and it changes how pausing a print behaves.

Alabaster works without it. A control that needs a macro from the pack hides
itself when the macro is missing.

## What it gives you

**A pause that gets the nozzle off the print.** Klipper's built-in pause stops
the nozzle where it is, on the part. This macro retracts filament, lifts Z,
and parks the nozzle instead.

**Pause at a layer.** The Print card's _Pause at a layer_ and _Pause when this
layer finishes_ options appear only when `SET_PAUSE_AT_LAYER` and
`SET_PAUSE_NEXT_LAYER` exist. `alabaster.cfg` defines both. See
[Print](/interface/modules#pause-at-a-layer) for more information.

**A cancel that cleans up.** Turns off the heaters and the part fan, parks the
nozzle, and resets the file.

**Load and unload filament.** Klipper defines no load or unload macros on its
own. `alabaster.cfg` provides them, and the
[Extruder](/interface/modules#extruder) card uses them to load and unload
filament.

## Installing it

The [installer](/guide/installation) can install the pack for you: it offers
it, clones it, and adds the include.

By hand: copy `alabaster.cfg` next to `printer.cfg`, then add this near the top
of `printer.cfg`:

```ini
[include alabaster.cfg]
```

Restart Klipper.

## How it gets onto the printer

The installer clones a second copy of this repository — the same one the
application itself comes from — into `~/alabaster-config`, pinned to the exact
release you installed. `alabaster.cfg` in your configuration directory is a
symlink into that clone, not a plain copy.

This differs from a separately-versioned companion repository. A macro pack
with its own repository and tags can drift out of step with the app version it
was written for. Cloning the same repository at the same tag prevents that:
the macro pack you have always matches the release you installed.

The macro pack also gets its own row on the
[Machine](/interface/machine#software-updates) page, separate from the app,
because Moonraker tracks a downloaded release and a git clone differently.
Updating one does not require updating the other, and the two can never
disagree about which version they are.

::: tip Editing it directly is fine
Because `alabaster.cfg` is a symlink, editing it — through Alabaster's own
Configuration page, or by hand — changes the file inside the clone. Moonraker
then shows that repository as having local changes the next time it checks for
updates. Use the same
[recovery flow](/interface/machine#recovering-a-broken-repository) already
used for Klipper and Moonraker's own update sources. This is the expected
outcome: it shows you that this copy is no longer identical to what shipped.
:::

If there is no network at install time, or the repository is unreachable, the
installer falls back to a plain copy of the file included in the release. This
copy still works, but Moonraker's update manager does not track it until the
clone is retried. Re-running the installer retries the clone on its own.

An install from before this existed leaves a plain file where the symlink now
goes. The installer detects this and backs up the old file as
`alabaster.cfg.pre-git-migration` instead of replacing it silently. Reapply any
of your own settings by editing the new file; there is no safe way to merge
them in automatically.

## If you are coming from another interface

::: warning Use one macro pack, not two
Established Klipper web interfaces ship their own config defining `PAUSE`,
`RESUME`, `CANCEL_PRINT`, and the layer-pause macros. Klipper refuses to start
when a macro is defined twice, so including both files breaks your printer.
:::

The installer checks for this before it changes anything. It reads
`printer.cfg` and everything it includes, globs included. If it finds a
conflicting definition, it names the macro and the file, and does not add the
include.

To switch: remove the other pack's include from `printer.cfg`, add
`[include alabaster.cfg]`, and restart Klipper. Your own macros are untouched;
only the pack's own definitions overlap.

To keep the other pack: leave `alabaster.cfg` out. Its layer-pause macros are
named the same way, so Alabaster's pause-at-layer controls work with that pack
too.

## Tuning it

Everything worth changing is in one block at the top. Edit the values, not the
macros below them.

```ini
[gcode_macro _ALABASTER]
variable_park_enabled: True
variable_park_x: -1
variable_park_y: -1
variable_park_lift: 10.0
variable_retract: 1.0
variable_retract_speed: 35
variable_unretract_extra: 0.0
variable_unretract_speed: 35
variable_travel_speed: 200
variable_park_at_cancel: True
variable_pause_extruder_off_after: 0
```

| Variable                   |                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ |
| `park_enabled`             | `False` pauses in place without moving at all.                                 |
| `park_x`, `park_y`         | Where to park, in millimetres. `-1` uses the middle of your bed.               |
| `park_lift`                | How far Z rises before travelling. Never goes past the top of your Z axis.     |
| `retract`                  | How much filament pulls back on pause, so it does not ooze while you are away. |
| `travel_speed`             | Speed for parking and for the move back, in mm/s.                              |
| `park_at_cancel`           | Whether a cancelled print parks as well as a paused one.                       |
| `pause_extruder_off_after` | Turn the hotend off this many seconds into a pause. `0` leaves it on.          |

Filament lengths have their own block, `_ALABASTER_FILAMENT` — set
`load_length` and `unload_length` to match the distance between your extruder
and your nozzle.

::: tip Turn off the hotend during long pauses
Set `pause_extruder_off_after` to a value such as `600` to turn off the hotend
during a long pause. On resume, Alabaster tells you the hotend is off and
waits for you to set a temperature, instead of pushing cold filament through
the hotend.
:::

## What it declares

Besides the macros, the file declares the Klipper sections they and Alabaster
need: `[pause_resume]`, `[display_status]`, `[respond]`, `[exclude_object]`,
and `[virtual_sdcard]`. The `[virtual_sdcard]` section sets
`path: ~/printer_data/gcodes` (the current default) and
`on_error_gcode: CANCEL_PRINT`, so a file error mid-print gets the same cleanup
as a manual cancel.

::: warning A different gcodes path, or an existing [virtual_sdcard]
If your install uses a different gcodes root — an older `~/gcode_files`, for
one — edit the `path` line to match, or delete the section entirely and keep
your own. The installer's conflict check catches the common case of
`[virtual_sdcard]` already being declared somewhere else in your
configuration, and skips the include rather than leaving Klipper unable to
start with it defined twice.
:::

::: warning If your printer has a display
Klipper enables `[display_status]` automatically when a `[display]` section
exists, and treats declaring it twice as an error. Delete the
`[display_status]` line from `alabaster.cfg` in that case. The installer warns
you when it sees a `[display]` section.
:::

## How pause-at-layer works

Klipper has no concept of a layer. These macros work because slicers announce
each layer with `SET_PRINT_STATS_INFO`, and the pack wraps and watches that
command.

This depends on your slicer emitting that command. Most slicers do, as part of
their Klipper output. If yours does not, the layer readout on the Print card
is empty too, since both rely on the same signal.

The wrapper always calls Klipper's own command first, so the layer counters
Alabaster displays keep working whether or not a pause is armed.

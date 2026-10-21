# Macros

`alabaster.cfg` is an optional Klipper config file for Alabaster. It provides
the macros some controls call, and it changes how pausing a print behaves.

Alabaster works without it. A control that needs a macro from the pack hides
itself when the macro is missing.

## What it gives you

**A pause that gets the nozzle off the print.** Klipper's built-in pause stops
the nozzle where it is, on the part. This macro retracts filament, lifts Z,
and parks the nozzle instead. A pause can last longer than Klipper's idle
timeout without the motors turning off, and resuming heats the hotend back up
if it was turned off in the meantime.

**Your own steps on pause, resume, and cancel.** Name a macro of your own in
the settings and the pack runs it at the right moment, such as playing a
sound or lowering the bed for a filament change. See
[Adding your own steps](#adding-your-own-steps).

**Pause at a layer.** The Print card's _Pause at a layer_ and _Pause when this
layer finishes_ options appear only when `SET_PAUSE_AT_LAYER` and
`SET_PAUSE_NEXT_LAYER` exist. `alabaster.cfg` defines both. See
[Print](/interface/modules#pause-at-a-layer) for more information.

**A cancel that cleans up.** Turns off the heaters and the part fan, parks the
nozzle, and resets the file.

**Load and unload filament.** Klipper defines no load or unload macros on its
own. `alabaster.cfg` provides them, and the
[Extruder](/interface/modules#extruder) card uses them to load and unload
filament. Both take an optional `TEMP`, such as `LOAD_FILAMENT TEMP=220`, to
heat the hotend first.

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

The installer clones a second copy of this repository (the same one the
application itself comes from) into `~/alabaster-config`, pinned to the exact
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
Because `alabaster.cfg` is a symlink, editing it (through Alabaster's own
Configuration page, or by hand) changes the file inside the clone. Moonraker
then shows that repository as having local changes the next time it checks for
updates. Use the same
[recovery flow](/interface/machine#recovering-a-broken-repository) already
used for Klipper and Moonraker's own update sources: it shows you that this
copy is no longer identical to what shipped.
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
`RESUME`, `CANCEL_PRINT`, and the layer-pause macros. Klipper does not report a
macro defined twice: the definition included last replaces the other one
without a warning. Including both files leaves you with a mix of the two, and
the pack's layer-pause cleanup and settings stop working.
:::

The installer checks for this before it changes anything. It reads
`printer.cfg` and everything it includes, globs included. If it finds a
conflicting definition, it names the macro and the file, and does not add the
include.

To switch: remove the other pack's include from `printer.cfg`, add
`[include alabaster.cfg]`, and restart Klipper. Your own macros are untouched;
only the pack's own definitions overlap. The same applies to a `PAUSE`,
`RESUME`, or `CANCEL_PRINT` of your own: move its steps into a
[hook](#adding-your-own-steps) instead of keeping the macro.

To keep the other pack: leave `alabaster.cfg` out. Its layer-pause macros are
named the same way, so Alabaster's pause-at-layer controls work with that pack
too.

## Tuning it

Everything worth changing is in one block at the top of the file:

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
variable_pause_idle_timeout: 3600
variable_user_pause_macro: ''
variable_user_resume_macro: ''
variable_user_cancel_macro: ''
```

To change a value without editing `alabaster.cfg`, repeat only that value in
a file of your own that is included after it. Klipper merges sections with
the same name, so the rest of the block keeps the pack's values, and the
pack's update source stays free of local changes:

```ini
[gcode_macro _ALABASTER]
variable_park_x: 290
variable_pause_idle_timeout: 43200
```

| Variable                   |                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ |
| `park_enabled`             | `False` pauses in place without moving at all.                                 |
| `park_x`, `park_y`         | Where to park, in millimetres. `-1` uses the middle of your bed.               |
| `park_lift`                | How far Z rises before traveling. Never goes past the top of your Z axis.      |
| `retract`                  | How much filament pulls back on pause, so it does not ooze while you are away. |
| `travel_speed`             | Speed for parking and for the move back, in mm/s.                              |
| `park_at_cancel`           | Whether a cancelled print parks as well as a paused one.                       |
| `pause_extruder_off_after` | Turn the hotend off this many seconds into a pause. `0` leaves it on.          |
| `pause_idle_timeout`       | Klipper's idle timeout during a pause, in seconds. `0` leaves it unchanged.    |
| `user_*_macro`             | A macro of your own to run on pause, resume, or cancel. `''` runs nothing.     |

Filament lengths have their own block, `_ALABASTER_FILAMENT`: set
`load_length` and `unload_length` to match the distance between your extruder
and your nozzle.

::: tip Turn off the hotend during long pauses
Set `pause_extruder_off_after` to a value such as `600` to turn off the hotend
during a long pause. Resuming heats it back to the temperature the print was
using before any filament moves.
:::

::: warning Long pauses and the idle timeout
When a pause outlasts Klipper's idle timeout, Klipper turns off the heaters
and the motors, and the print cannot be resumed. Klipper's default timeout is
600 seconds. `pause_idle_timeout` replaces it for the length of the pause, and
your configured timeout comes back on resume or cancel.
:::

## Adding your own steps

Each hook names a macro of your own. The pack calls it at a fixed point:

| Hook                | Runs                                                           |
| ------------------- | -------------------------------------------------------------- |
| `user_pause_macro`  | After the nozzle has parked.                                   |
| `user_resume_macro` | Before the hotend reheats and the nozzle returns to the print. |
| `user_cancel_macro` | After the print has been cancelled.                            |

```ini
[gcode_macro _ALABASTER]
variable_user_pause_macro: '_MY_PAUSE'

[gcode_macro _MY_PAUSE]
gcode:
  G91
  G1 Z20 F600
  G90
```

A resume macro can read where the print stopped from
`printer["gcode_macro _ALABASTER_STATE"]`: `resume_x`, `resume_y`, and
`resume_z` in G-code coordinates, and `resume_temperature`.

A hook that names a macro the printer does not have is reported in the
console and skipped. Pause, resume, and cancel still complete.

## What it declares

Besides the macros, the file declares the Klipper sections they and Alabaster
need: `[pause_resume]`, `[display_status]`, `[respond]`, `[exclude_object]`,
and `[virtual_sdcard]`. The `[virtual_sdcard]` section sets
`path: ~/printer_data/gcodes` (the current default) and
`on_error_gcode: CANCEL_PRINT`, so a file error mid-print gets the same cleanup
as a manual cancel.

::: warning A different gcodes path, or an existing [virtual_sdcard]
If your install uses a different gcodes root (an older `~/gcode_files`, for
one), edit the `path` line to match, or delete the section entirely and keep
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

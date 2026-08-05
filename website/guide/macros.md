# Macros

`alabaster.cfg` is a small Klipper config that does two things: it gives
Alabaster the macros some of its controls call, and it makes pausing a print
behave the way you would want.

It is optional. Alabaster works without it — the controls that need it hide
themselves rather than failing.

## What it gives you

**A pause that gets the nozzle off the print.** Klipper's built-in pause stops
where it is, leaving a hot nozzle resting on your part. This one retracts, lifts
Z, and parks.

**Pause at a layer.** Print's _Pause at a layer_ and _Pause when this layer
finishes_ only appear when `SET_PAUSE_AT_LAYER` and `SET_PAUSE_NEXT_LAYER`
exist. This defines them. See [Print](/interface/modules#pause-at-a-layer).

**A cancel that cleans up.** Turns off the heaters and the part fan, parks, and
resets the file.

**Load and unload filament.** Klipper defines no such macros of its own, so the
[Extruder](/interface/modules#extruder) card has nothing to offer until
something does.

## Installing it

The [installer](/guide/installation) offers it, clones it, and adds the
include for you.

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

That is a deliberate difference from a separately-versioned companion
repository. A macro pack that ships from its own repository, with its own
tags, can drift out of step with the version of the app it was written for —
a real, reported problem for exactly that arrangement elsewhere. Cloning the
same repository at the same tag makes that impossible: the macro pack you have
is always the one this exact release shipped with.

It also means the macro pack gets **its own row** on the
[Machine](/interface/machine#software-updates) page, separate from the app,
because Moonraker tracks a downloaded release and a git clone in different
ways. Updating one does not require updating the other, even though they can
never actually disagree about which version they are.

::: tip Editing it directly is fine
The symlink means an edit — through Alabaster's own Configuration page, or by
hand — changes the real file inside the clone. Moonraker will then show that
repository as having local changes the next time it checks for updates, the
same [recovery flow](/interface/machine#recovering-a-broken-repository)
already used for Klipper and Moonraker's own update sources. That is the
correct outcome, not a fault: it is what tells you, later, that this copy is no
longer identical to what shipped.
:::

No network at install time — offline, or the repository unreachable — falls
back to a plain copy of the file included in the release itself. It still
works; it just is not tracked by Moonraker's update manager until the clone is
retried, which re-running the installer does on its own.

An install from before this existed leaves a plain file where the symlink now
goes. The installer notices and backs it up as `alabaster.cfg.pre-git-migration`
rather than replacing it silently — reapply any of your own settings by
editing the new one, since there is no safe way to merge them in automatically.

## If you are coming from another interface

::: warning Use one macro pack, not two
Established Klipper web interfaces ship their own config defining `PAUSE`,
`RESUME`, `CANCEL_PRINT`, and the layer-pause macros. Klipper refuses to start
when a macro is defined twice, so including both files breaks your printer.
:::

The installer checks for this before it changes anything. It reads `printer.cfg`
and everything it includes — globs included — and if it finds a conflicting
definition it names **which macro and which file**, and does not add the
include.

To switch: remove the other pack's include from `printer.cfg`, add
`[include alabaster.cfg]`, and restart Klipper. Your own macros are untouched;
only the pack's own definitions overlap.

To keep the other pack: that is fine. Leave `alabaster.cfg` out. Its layer-pause
macros are named the same way, so Alabaster's pause-at-layer controls work with
that pack too.

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

::: tip A long pause need not cook your filament
Set `pause_extruder_off_after` to something like `600` and a pause you walk away
from stops baking the filament in the melt zone. Resuming tells you the hotend
is off and waits for you to set a temperature, rather than trying to push cold
filament through.
:::

## What it declares

Besides the macros, the file declares the Klipper sections they and Alabaster
need: `[pause_resume]`, `[display_status]`, `[respond]`, `[exclude_object]`, and
`[virtual_sdcard]` — the last with `path: ~/printer_data/gcodes`, the current
default, and `on_error_gcode: CANCEL_PRINT` so a file error mid-print gets the
same cleanup a manual cancel does.

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
exists, and treats declaring it twice as an error. Delete the `[display_status]`
line from `alabaster.cfg` in that case. The installer warns you when it sees a
`[display]` section.
:::

## How pause-at-layer works

Klipper has no idea what a layer is. These macros work because slicers announce
each layer with `SET_PRINT_STATS_INFO`, which the pack wraps and watches.

So it depends on your slicer emitting that command — most do as part of their
Klipper output. If yours does not, the layer readout on the Print card is empty
too, which is the same missing signal.

The wrapper always calls through to Klipper's own command first, so the layer
counters Alabaster displays keep working whether or not a pause is armed.

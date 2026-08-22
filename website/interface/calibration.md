# Calibration

Bed mesh, endstops, probe accuracy, filament sensors, and your tuning results,
in one place.

## Watching a mesh being probed

The height map draws points **as they arrive**, so a probing run that is going
wrong is visible while it runs rather than after it.

The count updates as it goes: _Probing — 34 points so far_.

::: info The shape settles as it goes
Each point is plotted against the average of the run so far, so early points move
as more arrive. It is provisional until the run finishes, and the page says so.
:::

**Scanning probes** sweep the bed instead of touching each point, so there is no
per-point report to follow. The page says that too, and fills the map in when the
mesh completes — rather than showing you an empty grid and letting you wonder.

## Mesh profiles

Every mesh saved on the printer, each carrying **the spread Klipper measured for
it**. That is the point: you can compare profiles without loading each one onto
the machine to find out what it says.

| Action           | Notes                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Calibrate mesh   | Runs `BED_MESH_CALIBRATE`.                                                      |
| Load             | Makes a saved profile active.                                                   |
| Save loaded mesh | Names and stores the mesh currently loaded.                                     |
| Rename           | Klipper can only rename the loaded profile, so the page says so when it is not. |
| Delete           | Asks first, and names the profile.                                              |

A mesh that has only been calibrated is not saved. It is gone at the next
restart, and the page tells you before that happens rather than after.

The [Bed mesh dashboard module](/interface/modules#bed-mesh) carries the same map
with the projections, render styles, colour scales, and warnings.

## Manual probing

When Klipper stops to ask where the bed is, **a prompt comes to you** — wherever
you are in the interface, and whoever started the probe. `MANUAL_PROBE`,
`Z_ENDSTOP_CALIBRATE`, `PROBE_CALIBRATE`, and your own macros around them all end
in the same wait, and it does not matter whether the command came from a macro
button here, the console, the printer's own screen, or another browser.

The height Klipper is holding is the number to watch. Beside it are **the two
heights already tried**, below and above — the pair a bisection is closing in on,
and empty until you have been somewhere in that direction.

| Control        | What it does                                                                  |
| -------------- | ----------------------------------------------------------------------------- |
| The halve pair | Halves what is left to the nearest height already tried that way, up or down. |
| The step grid  | Moves by a fixed distance, from a millimetre down to five micrometres.        |
| Accept         | Ends the probe at this height and hands it back to whatever asked.            |
| Abort          | Ends the probe without recording anything.                                    |

**Every button says the distance it will move**, including the halving pair —
whose number shrinks on its own as the bracket closes, so you can see how much
room is left without working it out. Klipper's own notation for those two
(`TESTZ Z=+`, and the `++` that goes the whole way) is still available in the
console for anyone who wants it.

The usual run is coarse steps down until the nozzle is close, then halving until
a sheet of paper is just gripped.

::: info Closing the prompt does not answer it
Closing the window — or pressing `Escape` — leaves the probe exactly where it is.
Only **Accept** and **Abort** end it, and while one is waiting the header carries
a **Manual probe** control that brings the prompt straight back. So heating the
nozzle first, or checking anything else in the interface, costs you nothing.
:::

A halving press never moves more than 0.2 mm. That is Klipper's own limit rather
than ours, and it means the pair cannot reach the bed however many times you press
it. The step grid has no such limit, so that is where the care is needed.

Whatever asked for the height gets it: a probe offset, a Z endstop position, the
rest of your macro. If it staged a config change, the header's
[**Save new config**](/interface/configuration) gate says so and writes it.

### Bed screws are their own prompt

`BED_SCREWS_ADJUST` is not a manual probe, even though it waits the same way: the
printer drives the nozzle to each screw and stops. It gets its own prompt, with
the screw's name, which round you are on, and Klipper's three answers — **Accept**,
**Adjusted** and **Abort**. It follows every rule above, including the one about
closing it: a **Bed screws** control appears in the header while a round is
waiting. See [the Movement module](/interface/modules#bed-levelling).

## Endstops

The live state of every endstop the printer reports: **Triggered**, **Open**, or
**Unknown**.

Klipper reports these only when asked, so Alabaster asks — every couple of seconds
while the printer is idle. **Read now** asks immediately.

Two things it will not do:

- **It stops while a print runs.** Querying endstops mid-print is not free, so the
  readings are paused and labelled as not current.
- **It does not throw away a good reading for a failed one.** If a read is
  refused, the previous values stay on screen and the page says the last read
  failed.

Each reading carries the time it was taken.

## Probe accuracy

Repeats one point ten times in place, and reports what the probe did:
**maximum**, **minimum**, **range**, **average**, **median**, and **standard
deviation**.

This separates a probe that is noisy from a bed that is uneven — the two look
identical on a mesh, and only one of them is fixed by probing more points. Run
it before you trust a mesh you are about to argue with.

It appears only on a printer that has a probe. Where the probe's offset would
carry it off the bed from where the toolhead is standing, the page says so and
the control waits rather than failing mid-run.

## Runout sensors

Every filament sensor the printer reports, as **Filament loaded** or **No
filament**, with a sensor that is switched off marked **Disarmed**.

These are read live, so a sensor tripped while you are probing the bed shows up
here without a refresh.

It reports state and does not change it: arming and disarming a sensor is not
offered here, so the **Disarmed** mark is what tells a genuine runout apart from
a sensor that was never watching in the first place.

## Tuning results

Your input-shaper output, read straight out of the printer's config folder.

| Category           | What it shows                          |
| ------------------ | -------------------------------------- |
| Input shaper       | The per-axis resonance graphs.         |
| Belts comparison   | Both belts against each other.         |
| Vibrations profile | Vibration against speed and direction. |
| Axes map           | The accelerometer orientation check.   |
| Static frequency   | A single-frequency measurement.        |

Open any of them at full size.

This is the difference between tuning results that live in a folder you have to
remember the path to, and tuning results that are in the interface next to the
mesh you were about to compare them with.

::: info Generated by Shake&Tune
These graphs come from the Shake&Tune tooling. Alabaster reads what it wrote; it
does not generate them. Without it installed, this section has nothing to show.
:::

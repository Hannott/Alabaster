# Calibration

Calibration is where you calibrate a printer, start to finish, without leaving
the page. Each job brings its own controls, its own readings, and the console
output Klipper answers with.

## The jobs

A rail lists the calibration jobs, in the order the physical dependencies run.
Picking one gives it the page.

| Job              | What it covers                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Axes & frame** | Homing, jogging, parking, the levelling procedure your printer has, screw turns, Z offset, endstop states |
| **Bed & probe**  | The height map, probe accuracy, saved mesh profiles                                                       |
| **Heaters**      | PID or MPC calibration per heater, with the temperature chart beside it                                   |
| **Resonance**    | Accelerometer noise, and the Shake&Tune graphs                                                            |
| **Extrusion**    | Pressure advance, retraction, extrude and retract, filament sensor states                                 |

A job your printer cannot do is not listed. A machine with no probe has no
**Bed & probe** entry; a machine whose only heater is bang-bang has no
**Heaters** entry. **Axes & frame** is always there, because endstops exist on
any machine with steppers.

## The console

A console sits below the job you are working on, so the lines Klipper answers
with arrive where you started the command.

It is the [Console page](/interface/console)'s console, not a smaller version of
it: the same transcript, the same command history, the same filters, and the
same command browser. A filter or a prompt position set in either place holds in
both. Its height follows the **Visible lines** setting in its own settings
panel.

**Console** in the page heading puts it away and brings it back.

::: info Config changes are still written from the header
A calibration stages a change rather than writing it. The header's
[**Save new config**](/interface/configuration) control appears when something
is waiting, says what would be written, and writes it.
:::

## Watching a mesh being probed

The height map draws each point as it arrives. You can see a probing run go
wrong while it is still running, not just after it finishes.

The point count updates live: _Probing — 34 points so far_.

::: info Point positions update as probing continues
Each point is plotted against the average of the run so far, so early points
can move as more points arrive. The mesh is provisional until the run
finishes, and the page marks it as such.
:::

Scanning probes sweep the bed instead of touching each point, so there is no
per-point report during the scan. The page states this, and fills in the map
once the mesh completes.

## Mesh profiles

Lists every mesh profile saved on the printer, each showing the spread
Klipper measured for it. This lets you compare profiles without loading each
one onto the printer to see what it contains.

| Action           | Notes                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Calibrate mesh   | Runs `BED_MESH_CALIBRATE`.                                                      |
| Load             | Makes a saved profile active.                                                   |
| Save loaded mesh | Names and stores the mesh currently loaded.                                     |
| Rename           | Klipper can only rename the loaded profile, so the page says so when it is not. |
| Delete           | Asks first, and names the profile.                                              |

A mesh that has only been calibrated is not saved. It is lost on the next
restart, and the page warns you before that happens.

See the [Bed mesh dashboard module](/interface/modules#bed-mesh) for the same
map, plus projections, render styles, colour scales, and warnings.

## Manual probing

When Klipper stops to ask where the bed is, a prompt appears wherever you are
in the interface. This happens regardless of who started the probe.
`MANUAL_PROBE`, `Z_ENDSTOP_CALIBRATE`, `PROBE_CALIBRATE`, and macros built
around them all end in the same wait. It does not matter whether the command
came from a macro button here, the console, the printer's own screen, or
another browser.

The height Klipper is holding is the number to watch. Beside it are the two
heights already tried, one below and one above. This is the bracket a
bisection closes in on. Each side stays empty until you have tried a height
in that direction.

| Control        | What it does                                                                  |
| -------------- | ----------------------------------------------------------------------------- |
| The halve pair | Halves what is left to the nearest height already tried that way, up or down. |
| The step grid  | Moves by a fixed distance, from a millimetre down to five micrometres.        |
| Accept         | Ends the probe at this height and hands it back to whatever asked.            |
| Abort          | Ends the probe without recording anything.                                    |

Every button shows the distance it will move, including the halving pair.
That number shrinks automatically as the bracket closes, so you can see how
much room is left without working it out yourself. Klipper's own notation
for these two moves (`TESTZ Z=+`, and `++` for the full distance) is still
available in the console.

The usual run is coarse steps down until the nozzle is close, then halving
until a sheet of paper is just gripped.

::: info Closing the prompt does not answer it
Closing the window, or pressing `Escape`, leaves the probe exactly where it
is. Only **Accept** and **Abort** end the probe. While a probe is waiting,
the header shows a **Manual probe** control that brings the prompt back. You
can heat the nozzle first, or check anything else in the interface, without
losing your place.
:::

A halving press never moves more than 0.2 mm. This is Klipper's own limit,
not Alabaster's, and it means the halving pair cannot reach the bed no
matter how many times you press it. The step grid has no such limit, so use
care there.

Whatever requested the height receives it: a probe offset, a Z endstop
position, or the rest of your macro. If the result staged a config change,
the header's [**Save new config**](/interface/configuration) control shows
this and writes it.

### Bed screws are their own prompt

`BED_SCREWS_ADJUST` is not a manual probe, but it waits the same way: the
printer drives the nozzle to each screw and stops. It has its own prompt,
showing the screw's name, the current round, and Klipper's three answers:
**Accept**, **Adjusted**, and **Abort**. It follows the same rules as manual
probing, including closing the window: a **Bed screws** control appears in
the header while a round is waiting. See
[the Movement module](/interface/modules#bed-levelling) for more information.

## Homing and levelling

**Axes & frame** carries the movement controls: home one axis or all of them,
jog, park, run whichever levelling procedure your printer is configured for
(`QUAD_GANTRY_LEVEL`, `Z_TILT_ADJUST`, `SCREWS_TILT_CALCULATE`,
`BED_SCREWS_ADJUST`, `DELTA_CALIBRATE`), read the screw turns Klipper answers
with, and set the Z offset.

These are the same controls as the
[Movement dashboard module](/interface/modules#movement), sharing its settings —
a jog step or park position changed in either place holds in both.

Jogging matters here for a specific reason: **probe accuracy** probes wherever
the toolhead currently sits. Positioning the toolhead first is part of that
check, and it happens on the same page.

## Heater models

**Heaters** runs `PID_CALIBRATE` or `MPC_CALIBRATE` per heater, whichever the
heater is configured for. The temperature chart sits beside it, because the run
drives the heater through its own heat-up cycle for several minutes and the
climb curve is how you see it behaving.

A bang-bang (`watermark`) heater has no constants to fit, so it is not offered.
Calibration is refused while a job is loaded, not only while one is printing: the
heat-up cycle ends a paused print as surely as it ruins a running one.

The result is staged, not written. Save it from the header.

## Endstops

The live state of every endstop the printer reports: **Triggered**,
**Open**, or **Unknown**.

Klipper reports endstop state only when asked. Alabaster asks every couple
of seconds while the printer is idle. **Read now** asks immediately.

Two behaviors to note:

- **Polling stops during a print.** Querying endstops mid-print is not free,
  so readings pause and are labelled as not current.
- **A failed read does not clear the last good reading.** If a read fails,
  the previous values stay on screen, and the page states that the last read
  failed.

Each reading carries the time it was taken.

## Probe accuracy

Repeats one point ten times in place and reports the results: **maximum**,
**minimum**, **range**, **average**, **median**, and **standard deviation**.

This distinguishes a noisy probe from an uneven bed. The two look identical
on a mesh, but only one is fixed by probing more points. Run this check
before you rely on a mesh's readings.

This section appears only on a printer with a probe. If the probe's offset
would carry it off the bed from the toolhead's current position, the page
states this and the control waits instead of failing mid-run.

## Extrusion

**Extrusion** carries pressure advance and its smoothing time, the retraction
figures, and the extrude and retract controls a pressure-advance check needs to
push filament through. Same controls and same settings as the
[Extruder dashboard module](/interface/modules#extruder).

## Runout sensors

Shows every filament sensor the printer reports, as **Filament loaded** or
**No filament**. A sensor that is switched off is marked **Disarmed**.

These update live. A sensor tripped while you are probing the bed shows up
here without a page refresh.

This section reports sensor state without changing it. The **Disarmed**
mark distinguishes a genuine runout from a sensor that was never active.

## Tuning results

Shows your input shaper output, read directly from the printer's config
folder.

| Category           | What it shows                          |
| ------------------ | -------------------------------------- |
| Input shaper       | The per-axis resonance graphs.         |
| Belts comparison   | Both belts against each other.         |
| Vibrations profile | Vibration against speed and direction. |
| Axes map           | The accelerometer orientation check.   |
| Static frequency   | A single-frequency measurement.        |

Open any of them at full size.

Tuning results appear in the interface, on the same destination as the mesh and
the belts you are comparing them against, instead of in a folder you have to
locate separately.

::: info Generated by Shake&Tune
These graphs come from the Shake&Tune tooling. Alabaster reads the files
Shake&Tune writes; it does not generate them. If Shake&Tune is not
installed, this section has nothing to show.
:::

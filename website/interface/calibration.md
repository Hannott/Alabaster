# Calibration

This page runs every calibration a printer supports, start to finish, without
leaving it. Each calibration shows what it needs, runs, and reports what it
found next to the value the printer had before.

## The jobs

The tabs under the page title list the calibration jobs, in the order the
physical dependencies run. Each job lists the calibrations your printer can run
there.

| Job              | Calibrations                                                                                                                           | Beside them           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Axes & frame** | Endstop check, stepper check, axis rotation distance, Z endstop position, endstop phase, TMC autotune, axis map                        | The Movement controls |
| **Bed & probe**  | Bed mesh, quad gantry level or Z tilt, bed screws, delta calibration, probe Z offset, probe accuracy, bed tilt, eddy and plugin probes | The height map        |
| **Heaters**      | Heater model (PID or MPC), heater limits                                                                                               | The temperature chart |
| **Resonance**    | Input shaper calibration, Shake&Tune shaper, belts and vibrations, accelerometer check and noise                                       | The Shake&Tune graphs |
| **Extrusion**    | Rotation distance, pressure advance or nonlinear pressure advance, filament sensors                                                    | The extruder controls |

A calibration your printer cannot run is not listed. A machine with no probe
has no **Bed & probe** entry; a machine whose only heater is bang-bang has no
**Heaters** entry. **Axes & frame** is always there, because endstops exist on
any machine with steppers. Calibrations from a plugin (Beacon, Cartographer,
klipper_z_calibration, klipper_tmc_autotune) appear when the plugin is
installed.

## Running a calibration

Pick a calibration from the list. It shows what it does, how long it takes,
and whether it moves the toolhead, heats, or probes.

- **Conditions** such as _Homed_ or _No print running_ are listed with a mark
  each. An unmet one says so and offers the fix, such as **Home all**. The band
  above the list shows the conditions for the whole job.
- **Values** you might change, such as a mesh profile name or a heater's
  target, are fields with Klipper's default shown. The command they build is
  shown under them.
- **Run** sends it. One calibration runs at a time.
- **The result** lists what the calibration found next to what the printer had
  before, and says where it went: staged for `SAVE_CONFIG`, applied until
  Klipper restarts, or measured only. **Show output** opens the lines the
  printer answered with.

Each calibration also shows when it last ran on this printer, and its earlier
results, with the same buttons the result had, so an older shaper run can still
be applied or saved. The record is kept on the printer, so every browser sees
the same dates. A calibration that is due, such as a mesh older than 30 days or heater
models older than 90, is marked as due, and the job opens on it.

## The console

A console can sit below the job you are working on, with every line Klipper
answered with. Each calibration's result and output are already in its own
panel, so the console is for the full transcript.

It is the [Console page](/interface/console)'s own console: the same
transcript, command history, filters, and command browser. A filter or a
prompt position set in either place holds in both. Its height follows the
**Visible lines** setting in its own settings panel.

The console starts closed. **Show console**, under the job, opens it.

::: info Config changes are still written from the header
Calibration stages a change instead of writing it. The header's
[**Save new config**](/interface/configuration) control appears when something
is waiting, says what would be written, and writes it.
:::

## Watching a mesh being probed

The height map draws each point as it arrives. You can see a probing run go
wrong before it finishes.

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
map, plus projections, render styles, color scales, and warnings.

## Manual probing

A prompt appears wherever you are in the interface when Klipper stops to ask
where the bed is. `MANUAL_PROBE`, `Z_ENDSTOP_CALIBRATE`, `PROBE_CALIBRATE`,
and macros built around them all end in the same wait, whether the command
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
much room is left. Klipper's own notation
for these two moves (`TESTZ Z=+`, and `++` for the full distance) is still
available in the console.

The usual run is coarse steps down until the nozzle is close, then halving
until a sheet of paper is just gripped.

::: info Closing the prompt does not answer it
Closing the window, or pressing `Escape`, leaves the probe where it is. Only
**Accept** and **Abort** end it. The header shows a **Manual probe** control
that brings the prompt back while a probe is waiting, so you can heat the
nozzle first or check anything else in the interface without losing your
place.
:::

A halving press never moves more than 0.2 mm. This is Klipper's own limit,
not Alabaster's, and it means the halving pair cannot reach the bed no
matter how many times you press it. The step grid has no such limit.

Whatever requested the height receives it: a probe offset, a Z endstop
position, or the rest of your macro. If the result staged a config change,
the header's [**Save new config**](/interface/configuration) control shows
this and writes it.

### Bed screws are their own prompt

`BED_SCREWS_ADJUST` waits the same way as a manual probe: the printer drives
the nozzle to each screw and stops. It has its own prompt, showing the
screw's name, the current round, and Klipper's three answers: **Accept**,
**Adjusted**, and **Abort**. It follows the same rules as manual probing,
including closing the window: a **Bed screws** control appears in the header
while a round is waiting. See
[the Movement module](/interface/modules#bed-levelling).

## Homing and levelling

**Axes & frame** keeps the movement controls beside its calibrations: home one
axis or all of them, jog, park, and set the Z offset. These are the same
controls as the [Movement dashboard module](/interface/modules#movement),
sharing its settings. On this page, a module's settings button opens all of its
settings, not only the ones pinned to its dashboard card.

The levelling procedure your printer is configured for (`QUAD_GANTRY_LEVEL`,
`Z_TILT_ADJUST`, `SCREWS_TILT_CALCULATE`, `BED_SCREWS_ADJUST`,
`DELTA_CALIBRATE`) is a calibration on **Bed & probe**. Its result shows the
retries and the final range, or the turn for each screw. The Movement module
on the dashboard keeps its **Level bed** button.

**Stepper check** moves one motor 1 mm back and forth ten times, to confirm
which motor it is and which way it turns.

**Axis map** (Shake&Tune) finds how the accelerometer is mounted. When the
detected `axes_map` differs from the one configured, one button writes it to
the accelerometer's section in your configuration.

## Axis rotation distance

Works out `rotation_distance` for any axis motor from the parts it drives:

- **Belt and pulley:** belt pitch × pulley teeth. A GT2 belt on a 20-tooth
  pulley is 40.
- **Lead screw:** thread pitch × starts. A T8 screw with 8 mm lead is 8.
- **Gear ratio:** a reduction between the motor and the pulley or screw, such
  as `80:20`.
- **Motor step angle:** 1.8° or 0.9°. The step angle goes in
  `full_steps_per_rotation`, not in `rotation_distance`. A 0.9° motor doubles
  steps per mm and halves the travel per step, and the result shows both next
  to what the printer has now.

**Measure a move** moves the axis a set distance slowly, and takes the distance
it really moved from a dial indicator or caliper. It is meant for a lead screw.
On a belt axis the calculated value is the better one. A move that went half or
twice as far as asked is a motor set up with the wrong step angle, and the panel
proposes the right `full_steps_per_rotation` instead of a wrong
`rotation_distance`.

**Write to the config** updates every motor that has to match: all Z motors
together, and both motors of a CoreXY. Untick any you drive differently. A
firmware restart loads the new values.

## Heater models

**Heater model** runs `PID_CALIBRATE` or `MPC_CALIBRATE`, whichever the heater
is configured for. Choose the heater and the target; tune at the temperature
you print at. The run takes several minutes. The temperature chart sits beside
it, because the climb curve is how you see the heater behaving. The result
shows the new constants next to the current ones.

A bang-bang (`watermark`) heater has no constants to fit, so it is not offered.
Calibration is refused while a job is loaded, not only while one is printing:
the heat-up cycle ends a paused print or ruins a running one.

**Heater limits** shows each heater's current constants and the
`verify_heater` limits Klipper shuts the printer down over, with Klipper's
defaults marked where the config sets none.

## Endstops

Shows the live state of every endstop the printer reports: **Triggered**,
**Open**, or **Unknown**.

Klipper reports endstop state only when asked. Alabaster asks every couple
of seconds while the printer is idle. **Read now** asks immediately.

- **Polling stops during a print.** Querying endstops mid-print is not free,
  so readings pause and are labeled as not current.
- **A failed read does not clear the last good reading.** If a read fails,
  the previous values stay on screen, and the page states that the last read
  failed.

Each reading carries the time it was taken.

## Probe accuracy

Repeats one point several times in place (ten unless you choose otherwise) and
reports **maximum**, **minimum**, **range**, **average**, **median**, and
**standard deviation**. Earlier runs are listed under the result.

This distinguishes a noisy probe from an uneven bed. The two look identical
on a mesh, but only one is fixed by probing more points. Run this check
before you rely on a mesh's readings.

Offered only on a printer with a probe. If the probe's offset would carry it
off the bed from the toolhead's current position, the calibration says so and
waits instead of failing mid-run.

## Extrusion

**Rotation distance** measures how far the extruder really moves filament.
Heat the hotend, mark the filament above the extruder, extrude a set length
slowly from the panel, and enter what is left to the mark. The panel works out
the corrected `rotation_distance` and writes it to the config line Klipper
uses. A firmware restart loads it.

For a new extruder, **From the hardware** gives the starting value: the drive
gear's effective diameter, the gear ratio of a geared extruder (such as `50:17`
for a BMG), and the motor's step angle. Measure an extrude afterwards, since a
drive gear bites deeper or shallower than its stated size.

**Pressure advance** sets a value and its smoothing time on the running
printer until the next restart. **Keep in the file** writes one that prints
well into your configuration.

The extruder controls sit beside them, the same as the
[Extruder dashboard module](/interface/modules#extruder).

## Nonlinear pressure advance

Tunes Kalico's
[nonlinear pressure advance](https://docs.kalico.gg/Nonlinear_Pressure_Advance.html)
from printed towers. You enter the heights you measure, and the page works out
each value, says which tower to print next, and writes the result to
`[extruder]`.

It appears on printers running Kalico's `bleeding-edge-v2` branch that have the
`[pa_test]` section and the `RUN_PA_TEST` macro from
[Kalico's setup instructions](https://docs.kalico.gg/Nonlinear_Pressure_Advance.html#setup).
Your own start G-code goes in that macro, so each tower heats, homes, and
purges the same way your prints do. On these printers the plain **Pressure
advance** calibration is not offered: its value would be written to an option
the nonlinear model does not read.

1. **Start** writes the values the guide starts from (a nonlinear model,
   `linear_advance` and `nonlinear_offset` at 0, and a `linearization_velocity`
   of 1 for direct drive or 2 for Bowden) and restarts Klipper. A leftover
   `pressure_advance` line is removed, because Klipper will not start with it.
2. **Print tower** runs `RUN_PA_TEST` for the tower that is open. **From** and
   **To** set the range the tower sweeps, so the range you see is the range
   printed.
3. Enter the height where the tower looks best, on the left side, the front, or
   both, depending on the tower. The value at that height appears straight
   away.
4. The page then does one of two things:
   - It suggests keeping the value, then names the next tower.
   - If the side and the front disagree by more than 1 mm, it suggests a 10%
     change to the other coefficient and a reprint of the same tower.
     A change that reverses direction halves the step, so repeated towers close
     in on a value instead of swinging past it.

**Direct drive** and **Bowden or high speed** follow the two orders in Kalico's
guide. The Bowden order keeps 80% of the first advance reading and returns to
the offset tower after the time offset.

Every tower stays available, so you can print one again at any point.
**Narrow around** re-centres a tower's range on the value just read, for a
closer second tower. Readings are kept on the printer, next to the value each
one worked out. **Save and restart** writes any of them to the config and
restarts Klipper, including one from an earlier tower. The table at the top
compares what the file holds with the latest calculated values. **Clear**
removes every reading and resets the tower fields; the config file is left as
it is.

::: info Towers print at your configured acceleration
`RUN_PA_TEST` prints at `max_accel` from `[printer]`, which the panel shows.
Set it to the highest acceleration you extrude at before printing towers.
:::

## Runout sensors

Shows every filament sensor the printer reports, as **Filament loaded** or
**No filament**. A sensor that is switched off is marked **Disarmed**.

These update live. A sensor tripped while you are probing the bed shows up
here without a page refresh.

This section reports sensor state without changing it. The **Disarmed**
mark distinguishes a genuine runout from a sensor that was never active.

## Input shaper and resonance

**Input shaper calibration** runs Klipper's own `SHAPER_CALIBRATE` and needs no
plugin. Its result shows the recommended shaper and frequency per axis next to
the configured ones, with the suggested `max_accel`. The result is staged for
`SAVE_CONFIG`. **Apply** puts both axes into effect right away, until Klipper
restarts; **Save config** runs `SAVE_CONFIG`.

**Accelerometer check** reads the accelerometer once to see that it answers.
**Accelerometer noise** reads background vibration for two seconds, so a fan
touching the toolhead or a loose mount shows before a real test.

With Shake&Tune installed, its shaper, belts, and vibrations tests are
calibrations too. The shaper test's recommendations appear in its result:
**Apply** puts both axes into effect until the next restart, and **Save
config** writes them to `[input_shaper]` in your configuration and restarts
Klipper to load them. Where the shaper lines are in the `SAVE_CONFIG` block,
they are updated there, which needs nothing else staged at the time. The belts
comparison is offered only on CoreXY and CoreXZ printers.

## Tuning results

Shake&Tune's graphs sit beside the resonance calibrations, read directly from
the printer's config folder.

| Category           | What it shows                          |
| ------------------ | -------------------------------------- |
| Input shaper       | The per-axis resonance graphs.         |
| Belts comparison   | Both belts against each other.         |
| Vibrations profile | Vibration against speed and direction. |
| Axes map           | The accelerometer orientation check.   |
| Static frequency   | A single-frequency measurement.        |

Every graph is listed by name and date, and the newest one is open beside the
list. A test that finishes opens its own graph.

**Compare** puts two graphs side by side, from any two tests: a belts
comparison beside an input shaper result shows what tensioning the belts did.
Click a graph to open it at full size.

::: info Generated by Shake&Tune
These graphs come from the Shake&Tune tooling. Alabaster reads the files
Shake&Tune writes; it does not generate them. If Shake&Tune is not
installed, this section has nothing to show.
:::

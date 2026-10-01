# Calibration

This page runs every calibration a printer supports, start to finish, without
leaving it. Each calibration shows what it needs, runs, and reports what it
found next to the value the printer had before.

## The jobs

The tabs under the page title list the calibration jobs, in the order the
physical dependencies run. Each job lists the calibrations your printer can run
there. Within a job, what checks that the hardware works comes first, and
what adjusts it after.

| Job              | Calibrations                                                                                                                                                                                                  | Beside them                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Axes & frame** | Endstop check, stepper check, sensorless homing, axis rotation distance, Z endstop position, endstop phase, TMC autotune, skew correction                                                                     | The Movement controls, and a stepper's direction |
| **Heaters**      | Heater limits, heater model (PID or MPC)                                                                                                                                                                      | The temperature chart                            |
| **Bed & probe**  | Load cell, probe accuracy, probe X/Y offset, probe Z offset, axis twist compensation, screw positions, bed screws, quad gantry level or Z tilt, bed tilt, delta calibration, bed mesh, eddy and plugin probes | What the calibration measures, or the height map |
| **Resonance**    | Accelerometer check and noise, axis map, belts, input shaper calibration, Shake&Tune shaper, vibrations                                                                                                       | The Shake&Tune graphs, or the shaper comparison  |
| **Extrusion**    | Filament sensors, rotation distance, pressure advance, tuning tower, nonlinear pressure advance                                                                                                               | The extruder controls                            |

The card beside a job is the dashboard's own, showing the part a calibration
reaches for: the Movement card's homing, jog and park controls on **Axes &
frame**, the Extruder card's hotend and extrude controls on **Extrusion**. Its
gear changes the same settings the dashboard card has.

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
  each. An unmet one says so and offers the fix: **Home all**, **Move over the
  bed** for a probe test whose probe would otherwise land past the bed's edge
  (to the mesh's zero reference, the safe-Z home, or the bed's centre, in that
  order), **Check accelerometer** before a resonance run, and **Clear mesh and
  Z offset** before a Z calibration, so what it measures is the probe alone.
  A fix waits while a calibration runs. The band above the list shows the
  conditions for the whole job.
- **Values** you might change, such as a mesh profile name or a heater's
  target, are fields with Klipper's default shown. The command they build is
  shown under them.
- **Run** sends it. One calibration runs at a time, from wherever it was
  started: the Movement card's **Level bed** and **Calibrate Z**, the bed mesh
  card's **Calibrate**, and a heater model from the Temperatures card run the
  same calibration this page does, are logged with it, and hold each other's
  buttons while they run.
- **The result** lists what the calibration found next to what the printer had
  before, and says where it went: staged for `SAVE_CONFIG`, applied until
  Klipper restarts, or measured only. A calibration that stages values
  without printing them, such as a delta calibration or a plugin's own
  calibration, still lists every value it staged, section by section, next to
  what the config file holds. A bed mesh lists the profile it went under, its
  range against the mesh that was loaded, its point count and the bed
  temperature it was probed at. **Show output** opens the lines the printer
  answered with.
- **A question, where only you can answer it.** The stepper check asks
  whether the motor moved, and the right way, once it has run. **Record
  answers** keeps them with the run.

Each calibration also shows when it last ran on this printer, and what the
printer is set to: the values its last run found, or, for one that has never
run here, the value in the config file, such as the probe's `z_offset` or the
configured input shaper. Its earlier results are listed with the same buttons
the result had, so an older shaper run can still be applied or saved; the
five newest are shown, and **Show all** opens the whole record of twenty. The
record is kept on the printer, so every browser sees the same dates. A
calibration that is due, such as a mesh older than 30 days or heater models
older than 90, is marked as due. A job opens on its first calibration. Under a result, the
panel names the next calibration on the job that is due or has never run
here, with **Open** to go to it. Klipper's input shaper calibration and
Shake&Tune's count as one: running either finishes the job, and neither is
named next after the other.

A few results are worth watching over time, and the earlier runs draw them:
the probe accuracy test's range and standard deviation, a mesh's range, and a
heater's PID constants each get a small line above the earlier runs once
three of them have reported it. A probe whose range creeps up between runs is
wearing or loose; a mesh whose range grows across a season is a bed warping;
PID constants that moved since the last tune say the re-tune was needed. The
line is drawn from the runs listed under it and has no scale of its own.

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

## Seeing what a bed calibration measures

On **Bed & probe**, the column beside a calibration draws what that
calibration is about:

- **Probe accuracy** plots every sample at the height it triggered, in the
  order it was taken, as the probe takes it. A single outlier, a steady drift
  while the probe warms, and an even scatter look different here even when
  their range is the same. An earlier run is drawn from its lowest, highest,
  average and median heights.
- **Probe Z offset** shows the probe and the nozzle over the bed at the moment
  the probe triggers, with the saved `x_offset`, `y_offset` and `z_offset`, and
  a new `z_offset` that is waiting for `SAVE_CONFIG`.
- **Bed screws** draws the bed to scale with each screw where the probe
  measures it, and the turn and height the last check found at each. The
  configuration holds where the nozzle goes for that, one probe offset away,
  and the drawing says by how much. **Bed screws by hand** is a paper test
  under the nozzle, so its screws are drawn as configured, with the one the
  nozzle is standing at marked.
- **Quad gantry level** and **Z tilt** draw the Z steppers and the probe points
  in the order they are probed, where the probe lands, with the range of the
  last run.
- **Probe X/Y offset** and **Screw positions** show the probe over the bed or
  the screws, with the Movement controls to jog with.

Once X and Y are homed, the nozzle is marked on the bed, and the probe beside
it with a dashed ring. Click a screw to send the toolhead there at its current
height: the probe goes over the screw for `[screws_tilt_adjust]`, the nozzle
for `[bed_screws]`, and whichever you chose while recording screw positions.
Every other bed calibration shows the height map.

## Seeing what the other calibrations measure

- **Stepper check** shows which way the chosen stepper should move the
  machine, so you can answer whether it moved the right way. On CoreXY a
  single motor moves the toolhead diagonally; a Z stepper on a printer with
  Z tilt or quad gantry level is marked at the corner it lifts.
- **Axis map**, **Belt comparison**, **Input shaper graphs** and
  **Vibration profile** open their own newest Shake&Tune graph, such as the
  accelerometer orientation plot for the axis map, and switch to a new one
  when a run finishes.
- **Input shaper calibration** compares every shaper Klipper fitted for each
  axis: its frequency, the vibration it leaves, its smoothing and the
  acceleration it allows, with the recommended one and the one in the config
  file marked. A shaper with slightly more vibration and a much higher
  acceleration may suit a fast printer better than the recommendation.

When a shaper run offers more than one shaper for an axis, you choose which
one **Apply** and **Save config** use: Shake&Tune's pick for performance or
for low vibrations, or any shaper Klipper fitted. The recommended one is
chosen until you pick another.

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

The top row moves the moving part up and the bottom row moves it down,
following [Z motion](/interface/settings#z-motion) as the Movement card does.
On a printer where Z+ lowers the bed, the top row raises the bed to close the
gap.

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

## Bed screws

**Bed screws** probes beside each screw and draws the result as the bed: each
screw in its corner, rear row first, with the turn that levels it against the
base screw and the height it probed at. A screw within a few minutes of a
turn says **Level**. **Go to** moves the toolhead over that screw, for a
paper check or to reach the screw with the nozzle out of the way. The turn
direction can be fixed for every screw, clockwise or counter-clockwise, so
you never turn one back. A run past the deviation limit set in the config
says so and asks for another run after the adjustment.

## Screw positions

Records the bed screws' coordinates by standing over them, instead of
measuring the bed with a ruler. The list starts with the screws already in the
section. To correct one, stand over it and **Re-record** it: the button names
the screw nearest the toolhead, which the drawing marks **Nearest**. To record
a full set, choose **Start over** and record each screw in turn; screw 1 is the
base screw the others are measured against. Choose the nozzle or the probe
separately for each screw, whichever is easier to line up there, and jog with
the Movement controls or click the screw on the drawing. The panel
works out what the section needs: `[screws_tilt_adjust]` wants where to send
the nozzle so the probe lands on the screw, `[bed_screws]` wants the nozzle
over it. A coordinate the nozzle cannot reach is moved to the nearest one it
can, and says so. **Save and restart** writes every screw at once, with the
names you gave them, and removes any screws the section had beyond the new
count, since Klipper refuses to start on them.

## Probe X/Y offset

Finds where the probe sits beside the nozzle, the way Klipper's probe guide
measures it: stand the nozzle on a mark near the middle of the bed and record
it, then stand the probe's sensing point on the same mark and record that. The
difference is `x_offset` and `y_offset`, shown next to the configured values,
and **Save and restart** writes both. Screw, mesh and tilt coordinates are
placed with the offset, so check them after it changes.

## Axis twist compensation

Corrects a probe that reads the bed differently along a twisted X (or Y) rail.
At each point along the axis the printer probes, then lowers the nozzle onto
paper at the same spot with the same dialog as the Z offset's paper test. The
calibration waits through every point and stages the compensation for
`SAVE_CONFIG`. Y is offered where `[axis_twist_compensation]` has a Y line to
calibrate on. Calibrate the probe Z offset again afterwards.

## Load cell

Scales a load cell, or a load cell probe, with a weight of known mass: start,
tare with nothing on the cell, place the weight and enter its mass, then
**Accept**. The panel shows the tare, the counts per gram and the capacity as
Klipper reports them, and any warning it gives about the tare or the sensor's
range. **Accept** stages `counts_per_gram` and `reference_tare_counts` for
`SAVE_CONFIG`; **Abort** leaves the saved calibration as it was.

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
which motor it is and which way it turns. Each stepper keeps its own result,
answers and earlier runs, so choosing another stepper shows what that one
found.

## Sensorless homing

Tunes the stall sensitivity of a TMC driver that homes without a switch,
following Klipper's TMC guide. With the carriage near the middle of its rail
(**Motors off** lets you push it there), set a sensitivity and home that one
axis, then say what it did: stopped short, homed with one touch, or homed and
banged. The panel keeps the list, finds the most sensitive value that still
homed and the least sensitive one that stopped with one touch, and proposes
the value a third of the way between them, from the second. **Save and
restart** writes it as `driver_SGTHRS` or `driver_SGT`. When the range is too
narrow to home reliably, the panel says so.

X and Y are offered on any driver that can detect a stall, also while they
still home on a switch. Such an axis shows the config lines it needs instead of
the search: `endstop_pin` on the driver's virtual endstop, `homing_retract_dist:
0`, the driver's DIAG pin, and the most sensitive starting value. **Fix config
and restart** writes them for that axis, and removes a `hold_current`, with one
restart. The DIAG pin starts as the axis's endstop pin, which a board's DIAG
jumper connects the driver to; change it where yours is wired elsewhere. The
same list names a `homing_retract_dist` or `hold_current` on an axis that is
already set up, since both spoil the search, and a `homing_positive_dir`
pointing away from `position_endstop`, which makes the homing move a millimetre
or two and fails at every sensitivity. A home that finds no stall at all is
recorded from Klipper's own error, and the next value offered is more sensitive. Z is offered only once it homes on
its driver, since Klipper advises against homing Z by stall.

## Skew correction

Squares the frame in software from a printed calibration object. **Clear
skew** first, print the object, and measure AC, BD and AD in each plane you
printed. The skew each set of lengths works out to shows as you type, so a
transposed digit is obvious before anything is sent. **Set and save profile**
sets the measured planes and stages the profile for `SAVE_CONFIG`; the saved
profiles are listed with their skew per plane. Klipper loads no profile on its
own, and the panel says so when no macro contains `SKEW_PROFILE LOAD`.

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

**Tuning tower** reads pressure advance, or firmware retraction's length, off
one printed tower, following Klipper's pressure advance guide. Choose direct
drive or Bowden for the guide's range, **Send tower**, and start the sliced
tower from Files; the value then changes with the print's height. Measure the
height that printed best, and the panel shows the value it was printed at next
to the one in the file. **Apply** runs it until the next restart, and **Save
and restart** writes it, which also puts back the slowed cornering the
pressure advance tower uses.

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
restarts; **Save config** runs `SAVE_CONFIG`. **Save max_accel** writes the
lowest acceleration the chosen shapers allow to `[printer]`, so corners are not
smoothed past the cap the calibration was run with.

**Axis map** (Shake&Tune) finds how the accelerometer is mounted. When the
detected `axes_map` differs from the one configured, one button writes it to
the accelerometer's section in your configuration.

**Accelerometer check** reads the accelerometer once to see that it answers.
**Accelerometer noise** reads background vibration for two seconds, so a fan
touching the toolhead or a loose mount shows before a real test.

With Shake&Tune installed, its shaper, belts, and vibrations tests are
calibrations too. Each takes the few values worth changing, with the default
shown until you type one: the shaper test's axis, smoothing cap, Z height and
frequency range; the belt test's frequency range; the vibration profile's
pattern size, speed ceiling, speed step and acceleration. Klipper's own
shaper calibration takes a smoothing cap, and probe accuracy takes the probe
speed and the retract between samples, so runs you mean to compare can be
run alike. The shaper test's recommendations appear in its result:
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

### Reading the belt graph

Under the belts comparison, **Reading the belt graph** turns the peaks you
read off the graph into a verdict: which belt is looser and by how much in
frequency, whether the belts already match within what the graph can show, or
whether the problem is the belt path rather than tension. Unpaired peaks hold
back any tension advice, since tightening a belt does not move them. The graph
cannot tell which belt is at the right tension, so the advice stays
conditional until you name a belt you measured with a pluck test or gauge.

Each belt is shown with the stepper that drives it. On CoreXY, Shake&Tune's
belt A is `stepper_y` and belt B is `stepper_x`.

On CoreXY, the **Axis cross-check** takes the toolhead and gantry masses and
the X and Y main peaks from the input shaper graphs, and predicts where those
peaks would sit if the belts were the softest part. An axis well below its
prediction is limited by something else, such as the toolhead mount, the
gantry or the frame, and tensioning will not raise it.

The masses and your last reading are saved per printer and included in backup
and sync.

::: info Generated by Shake&Tune
These graphs come from the Shake&Tune tooling. Alabaster reads the files
Shake&Tune writes; it does not generate them. If Shake&Tune is not
installed, this section has nothing to show.
:::

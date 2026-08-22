# Dashboard modules

Fourteen cards. This page covers what each one does and what is behind its
settings.

Every card has a quick-settings layer on the card and a full pane behind
**All settings** — see [how a card is built](/interface/overview#how-a-card-is-built).

## Print

The state of the job, and the controls for it.

- **Progress, elapsed, and remaining**, plus the **time of day it finishes**.
- **Layer and height**, current and total.
- **Filament used**, against the file's total.
- **Pause, resume, cancel**, and **Clear** to return a finished job to ready.
- **The slicer preview**, expandable.
- **Recent files**, so the next print is one click rather than a page away.
- **Up next** — what the job queue will start when this finishes, and whether
  the queue is paused and will not start it on its own.

Drop a G-code file from your desktop onto the card to upload it and start it.

When a print fails or is cancelled, the card quotes Klipper's own reason for it
— the sentence that would otherwise only be in `klippy.log`. Select it and paste
it into a search.

### Remaining time, and where it comes from

Choose the source under settings:

| Source              | Based on                                                    |
| ------------------- | ----------------------------------------------------------- |
| Best available      | Whatever the printer supports right now.                    |
| The slicer estimate | The time your slicer wrote into the file when it sliced it. |
| File position       | How far through the file the printer has read.              |
| Filament used       | Filament consumed against the file's total.                 |

The percentage follows whichever source you pick, so the figure, the bar, and
the drift warning always agree — including the percentage on the card's header
when you collapse it.

**Use the slicer progress (`M73`)** is a separate switch, and it applies to
_Best available_ only. `M73` is a live progress report your slicer has to be
configured to write; where the file carries none, the settings panel says so
rather than leaving you to wonder why the switch changed nothing.

### Drift warning

Alabaster compares what is happening to the slicer's estimate and tells you when
they part company: **`12% behind the slicer estimate`**, or ahead of it.

It is on by default and says nothing until the print has genuinely diverged. Set
the percentage that earns a warning under settings, or switch it off there.

### Pause at a layer

Two ways, both under the card's actions:

- **Pause at a layer** — name the layer and the print pauses as it starts.
- **Pause when this layer finishes** — for a colour change you decided on just
  now.

Both appear only on a printer whose configuration defines the macros they call.
[`alabaster.cfg`](/guide/macros) provides them, and so does an established
Klipper web interface's own macro pack.

### Exclude an object

If the file defines objects, **Exclude object** lists them with the one printing
now marked. Excluding one stops Klipper printing it and carries on with the rest
of the plate.

This cannot be undone for that job, and the confirmation says so.

### Also here

- **Reset speed and flow** when a print completes, is cancelled, or fails —
  chosen per outcome.
- **Maintenance overdue** appears on this card's header. Switch the reminder on
  under [Settings → Confirmations](/interface/settings#confirmations) and
  starting a print into an overdue interval asks first — however you start it
  here: Print again, a recent file, an upload, or a dropped file.
- **Confirmations** for starting and cancelling, switchable from the card's own
  settings.

## Camera

The first enabled webcam Moonraker returns.

No camera configured is said plainly. A stream that fails offers a retry rather
than leaving a broken frame.

## Temperatures

Every heater and temperature sensor the printer reports, with targets for the
ones that can be set.

### Arrival times

This is what the card is really for. Alongside the reading you get:

- **`~4 min`** — when this heater will reach its target.
- **`8°/min`** — how fast it is climbing.
- **`Not climbing`** — it has a target and it is not getting there.
- **`Almost there`** and **`At target`** for the end of the climb.

The estimate comes from watching your own machine: the real time it took to cross
each five-degree band on the way up, learned and reused. So a hot end that slows
above 200 °C and a bed that crawls through its last ten degrees are both accounted
for, and the answer stays right across PID and MPC alike.

### Adjusting one heater

**±5** nudges an active target by five degrees, and it is the one temperature
control that stays available while a job is running — leaning on a temperature
mid-print is ordinary. **Off** switches that heater alone off.

**Off**, the material presets and **Cooldown** are all out of reach while a job
is loaded, a paused one included: each of them ends a paused print rather than
pausing it further.

A `temperature_fan` gets the nudges but no **Off**. Klipper runs such a fan
whenever its sensor is above the target, so a target of zero would pin the fan on
rather than stop it — there is no off to offer.

### Reading the past

Point at the chart, and every temperature in the list above it becomes the one
recorded at that moment — the whole table moves back together, and the chart
names the moment it is showing. Arrow keys walk the same samples one at a time,
and Escape returns to the present.

Target boxes never follow: they always hold the setpoint the printer is on right
now, so nothing here can act on a number from four minutes ago.

### The chart

Turn on the history chart and choose what it draws:

| Setting                  | What it does                                                  |
| ------------------------ | ------------------------------------------------------------- |
| Sensors                  | Which sensors appear in the list, in the chart, or both.      |
| Colour                   | Each sensor's colour, from the Okabe-Ito palette.             |
| Height                   | Compact, standard, or tall.                                   |
| Time window              | How far back it goes.                                         |
| Draw target temperatures | The setpoint each trace is climbing toward, as a dashed line. |
| Scale to current values  | Or keep the scale fixed to the printer's configured maximums. |
| Start the scale at 0     | For reading absolute values rather than differences.          |
| Draw heater power        | Each heater's duty, on its own axis up the right-hand side.   |

History is seeded from Moonraker's own temperature store when you connect, so the
chart is not empty for the first ten minutes.

### Material presets

Buttons that set the hot end and bed together. Add your own, or **search the
catalogue** to pull real values for a filament instead of typing them from
memory. Leave one of a preset's two temperatures blank and pressing it leaves
that heater exactly as it is — useful for a filament that cares about the hot end
and not the bed.

**Cooldown** turns every heater off at once.

### Heater calibration

**Calibrate PID** and **Calibrate MPC** run from the card, on the heater you
choose, at the temperature you choose — usually the material you print most.

The output appears as it runs. When it finishes, the new model is staged in
Klipper, and the card says so: **save the new config to keep it**.

::: warning It heats the printer
Calibration runs for several minutes and physically heats the machine. It asks
before starting, and it is unavailable while a job is loaded — a paused print
included, since the heat-up cycle would end it.
:::

## Movement

Position, homing, and everything that moves the toolhead.

- **Per-axis homing**, plus home all, with unhomed axes marked.
- **Jogging** at step sizes you set, in millimetres.
- **Motors off**, which asks first — the printer forgets where it is.
- **Park positions** — centre and front.
- **Speed factor**, with a reset to 100%.
- **Position mode** — absolute or relative, as reported.
- **Live speed** of the toolhead, so a slow move and a refused one look different.

Jogging keeps working while a print is **paused** — reaching the nozzle is often
why you paused it. Homing, motors off and bed levelling do not: each of those
ends a paused print rather than interrupting it.

![The Movement settings pane beside the card, with step sizes, Z offset steps, and confirmations](/images/modules/movement-settings-popout.png)

### The bed plan

A picture of your actual bed. Press a spot — and drag to correct it without
lifting — or use the arrow keys, then **Go** to send the nozzle there. A
double-click and the Enter key do the same thing. One press only aims: this is
the one control that can order a move right across the bed, and over a printed
part that is a crash.

Before homing it says the position is unknown rather than drawing a nozzle
somewhere it might not be. It can be set to show during printing too, or not.

Hovering the plan or the Z slider beside it previews that coordinate in the
corner reading without moving anything.

### Z offset

The controls read in **micrometres or millimetres**, and the legend says which
direction is closer to the bed — because getting that wrong costs a nozzle.

- **Steps** in your chosen unit; the printer is sent millimetres either way.
- **Swap Z direction** for printers whose bed moves rather than the gantry, so Z
  zero is at the top of the slider.
- **Save offset** folds the current adjustment into whatever sets Z zero on your
  machine: the probe's own Z offset where there is a probe, the Z endstop
  position where there is not. A printer with neither has nowhere to put it, and
  the control is not offered rather than failing when pressed.

An applied offset that has not been saved says so: _applied to the probe, save
the new config to keep it_.

### Bed levelling

Whichever your printer supports, run from the card:

| Action            | Klipper feature         |
| ----------------- | ----------------------- |
| Level gantry      | `QUAD_GANTRY_LEVEL`     |
| Adjust Z tilt     | `Z_TILT_ADJUST`         |
| Check bed screws  | `SCREWS_TILT_CALCULATE` |
| Adjust bed screws | `BED_SCREWS_ADJUST`     |
| Calibrate delta   | `DELTA_CALIBRATE`       |

Screw results are shown as a table of turns and minutes, clockwise or
counter-clockwise, against the reference screw. All of them ask before starting.

**Adjust bed screws** is a conversation, not a one-shot: the printer moves the
nozzle to each screw in turn and waits. A prompt names the screw it is standing
at and how far through the round you are, and you answer **Accept**, **Adjusted**
— if you turned it enough to matter, which starts the round again because that
screw changes the others — or **Abort**. Put the prompt aside to do something
else and the header keeps a way back to it.

On a gantry printer, the card says when the gantry has not been levelled since
the motors were last off. Every axis reads as homed on a machine that is out of
square, so nothing else would tell you until the first layer came out thick at
one end.

## Controls

Fans and output pins.

- **Part fan** and every other controllable fan.
- **Fans Klipper controls** — the ones it drives itself, shown read-only, so you
  can see what a heater fan is doing without being able to fight it.
- **Output pins**, as toggles or levels depending on how they are configured.

### Giving an output an icon

Under **Icons** in the card's settings, each fan and pin can carry one of five
icons — **Fan**, **Light**, **Probe**, **Temperature**, or **Power** — or none
at all.

This is worth the minute it takes. An output pin's name is whatever it is called
in `printer.cfg`, and `output_pin caselight` in a list of four is not something
you read so much as decode. A row of icons is.

A fan starts out looking like a fan. A pin starts out with no icon, because a
pin can be anything — guessing that one switches power was wrong more often than
it helped. Any row can be set to no icon deliberately, fans included.

## Machine

The motion limits, live:

| Limit                  | Unit  |
| ---------------------- | ----- |
| Velocity               | mm/s  |
| Acceleration           | mm/s² |
| Square corner velocity | mm/s  |
| Minimum cruise ratio   | ratio |

Two settings keep them from being a hazard: **lock the limits while printing**,
and **reset them when the print completes, is cancelled, or fails** — chosen per
outcome, so a tweak for one job does not silently become permanent.

## Macros

The macros you choose, as buttons.

- **Search and pick** from everything the printer reports.
- **Order them** the way you use them.
- **Colour each button** from the Okabe-Ito palette.
- **Run with parameters** — a macro that takes arguments opens a small form, and
  an empty field lets the macro apply its own default.
- **Missing macros are marked** rather than silently dropped, and can be hidden
  entirely once you have stopped caring.

![A Nozzle/Probe macro group on the dashboard, split into Nozzle and Probe headings](/images/modules/nozzle-probe-buttons.png)

### Groups

This card can appear more than once, each with its own name and its own macros.

Each group can be set to show only while the printer is **idle**, **paused**, or
**printing**. So the pre-print macros are out of the way mid-job, and the
mid-print ones appear when they are useful.

### Headings

Split a long list into named sections, right on the card.

A heading rides the same list a macro does — drag it, reorder it, or delete it
through the exact controls a macro already uses, so splitting a group into
sections needs no separate mechanism to learn. **Add heading** sits pinned above
the available-macros list, reachable without scrolling however long the
printer's own macro catalogue runs.

An emptied heading still shows as a bare rule rather than disappearing, so the
card never looks like it silently dropped what the settings pane still lists.

![The macro settings pane with a list split into Nozzle and Probe headings](/images/modules/macros-heading-example.png)

## Extruder

Extruding, retracting, and the tuning that goes with them.

- **Extrude and retract** at a length and feedrate you set. Disabled below the
  minimum extrusion temperature, saying what that temperature is.
- **Extrusion factor**, with a reset to 100%. This is the value Klipper carries
  from one job to the next, which is why the collapsed card always shows it.
- **Macro buttons** for whatever your load and unload macros are called — Klipper
  defines none of its own, so this is a picker rather than a fixed pair.

### Pressure advance

Set the advance and smooth time, with the active value shown.

Where the firmware sets the model in `printer.cfg` instead, the card reads the
values rather than pretending to adjust them. A value set from here is lost on
restart, and the card says so.

### Firmware retraction

If `[firmware_retraction]` is configured: retract length and speed, unretract
extra length and speed, and Z hop height.

## Spool

Requires Moonraker's Spoolman component. Without it the card does not appear.

- **The active spool**, its filament, and what is left by weight and by length.
- **Switch spool** from the card.
- **Enough for the next print** — or _not enough filament left, needs 340 g, this
  spool has 210 g_.
- **Temperature mismatch** — the loaded filament is set for 215 °C and the next
  file heats the hot end to 250 °C.
- **Pause automatically when Spoolman reports the spool is empty.**

::: info It is Spoolman's number, not a sensor
The remaining weight comes from Spoolman's own tracking. It is only as good as
what Spoolman knows, and it is not a runout sensor.
:::

## Bed mesh

The measured bed, as a map you can actually read.

- **2D map** — top-down, always.
- **3D height map** — with **ten projections** (perspective, orthographic,
  isometric, dimetric, trimetric, cavalier, cabinet, one-point, two-point,
  fisheye) and **five render styles** (surface, bars, contour, terraced, mosaic).
- **Probed points**, the mesh, and a level reference, each shown or hidden.
- **Readout** of X, Y, and height wherever you point.
- **Lowest, highest, and range** as numbers, not just colours.

![A bed mesh rendered as a 3D surface, with the active profile, projection, and lowest/highest/range readout](/images/modules/bed-mesh-3d-view.png)

![The Bed mesh quick settings, toggling the mesh/probed/level layers, the wireframe, probed points, and per-mesh colour scaling](/images/modules/bed-mesh-quick-settings.png)

### The colour scale

Two modes, and the difference matters:

- **Scaled to this mesh** makes the most of the colour range for one mesh.
- **Fixed scale**, at a value you set, lets two meshes be compared. One scaled to
  itself and one scaled to itself are two pictures, not a comparison.

### Two warnings

- **Bed range** — the bed varies by more than the amount you called acceptable.
  Set to zero to turn it off.
- **Probe temperature drift** — _this mesh was probed at 60 °C, but the bed is now
  targeting 100 °C — recalibrate before trusting it._ A mesh measured cold and
  used hot is wrong, and nothing else in the interface would tell you.

### Profiles

Load, save, rename, and delete the meshes on the printer. A mesh that has only
been calibrated is lost on the next restart, and the card says so before you get
caught by it.

Deeper mesh work lives on the [Calibration](/interface/calibration) page.

## Job queue

Moonraker's queue.

Start it, pause it, clear it, and remove single jobs. Drop a file from your
desktop onto the card to upload it and add it to the end.

## Console

A compact console on the dashboard: recent output and a prompt.

It carries the two filters you reach for mid-print and a line count for how tall
it should be. The full set of filters and display options is on the
[Console page](/interface/console), and the two keep their own settings — a quiet
card and a verbose page is a valid combination.

## Activity

What the printer has been doing: state changes, prints starting and finishing,
and commands sent.

Every event carries a symbol and text, never colour alone.

## Maintenance

Service intervals counted against the printer's own lifetime totals.

Add an interval and choose what measures it:

| Measured by | Counted from                                   |
| ----------- | ---------------------------------------------- |
| Print time  | Hours the printer has actually spent printing. |
| Filament    | Metres extruded.                               |
| Calendar    | Days since you last performed it.              |

Each shows what is left — `in 40h`, `in 120 m`, `in 12d` — or how far past it you
are: `18h over`.

**Performed** resets the interval from now. A brand-new interval needs a baseline
before it can count, and says so.

### The part that makes it work

Switch on **Ask before starting a print while a maintenance interval is overdue**
under [Settings → Confirmations](/interface/settings#confirmations), and starting
a print while something is overdue asks you first — from the Print card and from
Print files alike. Open Maintenance, start anyway, or wait.

A reminder you have to remember to look at is a reminder you will not look at.
This one comes to you at the only moment it matters. It is off until you ask for
it, because it interrupts starting a print. **Start anyway** quiets it until
tomorrow, and **Not now** — for the interval you already know about and have the
part on order for — quiets it for a week.

The Print card also carries an overdue warning in its header, and the collapsed
Maintenance card reads `Overdue` — never a count, because even one overdue
interval is the whole story.

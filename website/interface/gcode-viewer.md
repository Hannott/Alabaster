# G-code Viewer

The G-code Viewer shows what a sliced file will print, follows a running print
bead by bead along the file's own moves, and replays any file at up to 20× with
no printer connected. It is built to run on modest hardware: a phone, a laptop
with integrated graphics, or the Pi's own browser.

Everything you need sits on the picture itself. The file and its colouring are
top left, the view tools top right, the layer range runs down the right edge,
and playback runs along the bottom.

## Opening a file

Open a file from the printer or from this device. The file list searches as you
type, newest first, and a job that is printing right now is offered at the top.

Opening a local file reads it here and uploads nothing, so you can check a slice
before committing to it.

A file over about 150 MB asks before loading, since rendering it holds the whole
file in memory on your device; a device that has already struggled asks from
about 40 MB. Files above 4 GB are rejected.

## Following a live print

**Follow** tracks the job Klipper is printing. It walks the actual moves in the
file instead of interpolating between position reports, so corners stay sharp
and the marker never cuts across a curve.

Nothing ahead of the print position is drawn. Only what has printed is shown,
so the model's edge always matches real progress, and printed geometry shows in
the printed colour.

Follow needs the loaded file to be the one printing. If the printer is running a
different file, or nothing is printing, the control says so instead of
guessing. Following trails the physical toolhead by a couple of seconds; the
delay is what provides enough known path ahead to draw the motion continuously.

With reduced motion set in your operating system, the continuous path becomes
discrete position updates.

## Inspecting the toolpath

**Colour** changes how moves are coloured:

- **Single**: One colour for the whole model.
- **Feature**: Colours each move by its type: external and inner perimeters,
  infill, solid infill, bridges, support, skirt and brim. The legend lists
  only the types present in the file. A file from an unrecognized slicer
  shows its moves as unclassified.
- **Feed rate**: Shades moves from slow to fast across the speeds this file
  actually uses. Use it to find where the slicer reduced speed.

**Travel moves** draws the non-printing moves between extrusions. Use it to
spot stringing across the model's surface. The two lowest detail levels draw
no travel moves, and the control says so rather than doing nothing.

**File information** lists the layer count, rendered moves, extrusions and
travels, file size, estimated time, filament, object height, the slicer that
produced the file, and the detail level in use.

## Layers and cross-sections

The rail on the right edge has two handles. The top one sets the highest
visible layer, the bottom one the lowest. Press anywhere on the rail and the
nearest handle follows your pointer; a bubble reads out the layer number and
its height.

Raise the bottom handle to cut a horizontal slice out of the middle of the
print and look inside a solid object. Bring both handles together to inspect
a single layer with its top surface intact. A handle with keyboard focus moves
one layer per arrow key.

While a print is being followed or a file replayed, the print's own position
chooses the visible layers.

## Moving the view

Drag with the left mouse button to rotate the model. Drag with the right or
middle button to pan; the model stays under the pointer as you drag. Use the
scroll wheel to zoom: each step moves the same share of the distance, so a
notch from far away and a notch up close feel alike.

Arrow keys pan the view. <kbd>Shift</kbd> with the arrow keys rotates it.
<kbd>+</kbd> and <kbd>-</kbd> zoom, and <kbd>0</kbd> resets the view. The
reset button top right does the same, and the button beside it saves a
screenshot of the current view.

On a touchscreen, one finger rotates the model. Two fingers pan and pinch to
zoom, the same gesture used on the bed mesh map.

## Replaying a file

Play replays the file from the beginning at the speeds specified in the file,
from 1× up to 20×. Scrub to any point, jump to the end, or return to the start.
Replay works without a printer connected. Use it to read a slice, check where a
long print spends its time, or find a problem before printing it.

During a replay the selected colour mode still applies to what has been
printed, and geometry ahead of the position is not drawn.

## Rendering quality

**Rendering quality** defaults to **Auto**. The viewer draws a file at one of
five detail levels, from solid beads at full detail down to plain lines with no
travel moves. The level is chosen when a file loads, from your setting, the
file's size, and what this device managed before; while you look, sharpness is
adjusted live to keep the view responsive. File information states the level
in use.

**Quality** starts every file at the highest level your device has sustained.
Use it for screenshots. **Performance** starts every file lower. On a phone,
a Raspberry Pi's browser, or a laptop without dedicated graphics, use Auto or
Performance.

A device that ran out of resolution to give and was still slow starts the next
file one level lower on its own. If a previous load never finished, the next
session starts at the lowest level and says so in File information.

## Viewer settings

The gear opens the viewer's settings. **Nozzle diameter** is used only for
moves that do not state how much filament they extrude; leave it empty to
follow what the printer reports. The same dialog lists the pointer, touch and
keyboard controls.

## Narrow screens

The picture fills the screen and the controls stay on it; at phone width the
legend steps aside. The viewer is available from the overflow menu instead of
the bottom bar, since it uses more device resources than a page suited to a
permanent slot.

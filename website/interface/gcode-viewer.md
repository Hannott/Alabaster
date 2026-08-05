# G-code Viewer

See what a sliced file will actually print, and watch a running job build itself
up bead by bead — following the real toolhead along the real path, not a dot
sliding between telemetry samples.

Large files are the point rather than the exception. A hundred-megabyte print
starts drawing about a quarter of a second in and keeps filling in while the rest
downloads and parses, so you can orbit and inspect a model long before it has
finished loading.

## Opening a file

The **Load G-code** card lists what is on the printer, newest first, and filters
as you type — useful once a library has more files than a dropdown can show. Pick
one and choose **Load**.

Two shortcuts save you finding a file twice:

- **Load current print** jumps straight to the job that is running.
- **Open local file** reads a file off this device without uploading it. Nothing
  is sent to the printer, so this works for checking a slice before you commit
  to it.

Print files can also hand a file straight here, which is the usual route in from
browsing.

A file over about 150 MB asks before it loads, because rendering one costs real
memory on the device you are sitting at. Files above 4 GB are declined outright.

## Following a live print

With **Follow live toolhead** on, the viewer tracks the job Klipper is printing
from — and it does so by walking the actual moves in the file rather than by
guessing between position reports. Corners stay corners; the marker does not cut
across a curve because two samples happened to land either side of it.

What you see on the active layer is the truth as Klipper reported it: geometry
ahead of the print is **not drawn at all** rather than dimmed, so the frontier is
exactly where printing has got to. Finished layers below take the printed colour.

This requires that the file loaded here is the file being printed — the viewer
checks that itself, and quietly falls back to plain position tracking if it
cannot be sure, or if anything about the job stops adding up. Following trails
the printer by a couple of seconds on purpose: that delay is what buys enough
known path to draw continuously without inventing motion the printer has not
been told to make yet.

Reduced-motion settings turn the continuous path off in favour of discrete
position updates.

## Inspecting the toolpath

**Colour** answers different questions about the same file:

- **Single** is one colour for everything — the calmest read of a shape.
- **Feature** colours each move by what it is for: external and inner
  perimeters, infill, solid infill, bridges, support, skirt and brim. The legend
  lists only what the file actually contains. Slicers name these differently and
  a file from an unsupported one shows its moves as unclassified rather than
  pretending to know.
- **Feed rate** shades from slow to fast across the speeds this file uses for
  extrusion, which is how you find where a slicer decided to crawl.

**Highlight seams** marks where extrusion paths begin and end — where a wall's
start and stop meet, and where you would look for a visible scar on the print.

## Layers and cross-sections

The **Visible layer** slider is the top of what you see. **Lowest visible layer**
is the bottom of it, so raising it cuts a horizontal slice out of the middle of a
print: set both near the same value to inspect one layer, or lift the floor to
look at the inside of a solid object.

**Show travel moves** draws the non-printing moves between beads, which is how
you spot a slicer stringing across a surface it should have avoided.

## Moving the view

Drag with the left button to turn the model, the right or middle button to slide
it, and the wheel to zoom. Zooming closes in on whatever is under the pointer,
and turning happens around the surface you are looking at rather than a fixed
point in space — so inspecting a detail does not send it swinging out of frame.

Double-click, or press <kbd>0</kbd>, to frame the whole model again. Arrow keys
pan, <kbd>Shift</kbd> with them turns, and <kbd>+</kbd> and <kbd>-</kbd> zoom.

The chips in the corner of the view zoom, reset the framing, and save a
screenshot of exactly what is on screen. The gear beside them holds two
preferences worth knowing about:

- **Rotation pivot** decides whether turning happens around the centre of the
  view or the point under the pointer.
- **Snap to centre** slides whatever you grabbed to the middle as you start to
  turn it, which some people find steadier and others find distracting.

## Replaying a file

**Start simulation** plays the file through from the beginning at the speeds it
asks for, at up to 20×, with a scrubber to jump anywhere. It needs no printer:
this is for reading a slice, checking where a long print spends its time, or
finding the moment something goes wrong before you commit filament to it.

Choosing a colour mode while simulating inverts how progress reads — printed
geometry keeps its feature or speed colour and the rest fades to a shell — so
the distinction you turned on survives the playback.

## Keeping it smooth

**Rendering quality** defaults to **Auto**, which measures how fast frames are
actually taking on this device and adjusts how much detail it draws to keep the
view responsive. It gives up geometry detail first, then sharpness, and never
changes what the model means: the layer a print is actively building always draws
at full precision no matter how far out you are zoomed.

**Quality** pins the highest detail, which is what you want for a screenshot.
**Performance** starts frugal and works up, and additionally squares off the
extrusions instead of rounding them. That is worth knowing for two reasons: it
roughly doubles the frame rate when you are orbiting close in on a large model,
and because square extrusions have no curvature to catch the light, a
zoomed-out model looks calmer and more solid rather than grainy. On a phone or a
Raspberry Pi's own browser, Auto or Performance is the difference between a
usable view and a stalled one.

## Narrow screens

Below roughly 55 rem the controls stack above the view and the page scrolls as
one. The viewer is reachable from the overflow menu rather than the bottom bar —
it is a heavy page that earns a deliberate visit rather than a permanent slot.

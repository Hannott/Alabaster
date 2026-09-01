# G-code Viewer

The G-code Viewer shows exactly what a sliced file will print. It also tracks
a running print live, building the model bead by bead by following the
actual toolhead path, not an interpolated position between telemetry
updates.

The viewer is built for large files. A 100 MB file starts rendering in about
a quarter of a second and keeps filling in while the rest of the file
downloads and parses. You can orbit and inspect the model before it finishes
loading.

## Opening a file

The **Load G-code** card lists the files on the printer, newest first. Type
to filter the list. Select a file and choose **Load**.

Two shortcuts save you a search:

- **Load current print**: Jumps to the file for the job currently printing.
- **Open local file**: Loads a file from this device without uploading it to
  the printer. Use it to check a slice before committing to it.

A file over about 150 MB asks for confirmation before loading, since
rendering it uses significant memory on your device. Files above 4 GB are
rejected.

## Following a live print

**Follow live toolhead** tracks the job Klipper is currently printing. It
follows the actual moves in the file instead of interpolating between
position reports, so corners stay sharp and the marker never cuts across a
curve.

Geometry ahead of the current print position is not drawn. Only what has
printed is shown, so the model's edge always matches real progress.
Finished layers show in the printed color.

This feature requires that the loaded file matches the file being printed.
The viewer checks this automatically and falls back to plain position
tracking if it cannot confirm a match, or if the job data becomes
inconsistent. Following the toolhead trails the actual printer position by a
couple of seconds; this delay provides enough known path ahead to draw the
motion continuously.

Reduced-motion settings replace the continuous path with discrete position
updates.

## Inspecting the toolpath

**Color** changes how moves are colored:

- **Single**: One color for the whole model.
- **Feature**: Colors each move by its type: external and inner
  perimeters, infill, solid infill, bridges, support, skirt, and brim. The
  legend lists only the types present in the file. A file from an
  unrecognized slicer shows its moves as unclassified.
- **Feed rate**: Shades moves from slow to fast based on the extrusion
  speeds in the file. Use it to find where the slicer reduced speed.

**Highlight seams** marks where each extrusion path starts and stops: the
points where a seam can appear on the print.

## Layers and cross-sections

The **Visible layer** slider sets the top layer shown. **Lowest visible
layer** sets the bottom layer shown. Raising the lowest layer cuts a
horizontal slice out of the middle of the print. Set both sliders to the
same value to inspect a single layer, or raise the lowest layer to see
inside a solid object.

**Show travel moves** draws the non-printing moves between extrusions. Use
it to spot stringing across the model's surface.

## Moving the view

Drag with the left mouse button to rotate the model. Drag with the right or
middle button to pan. Use the scroll wheel to zoom. Zooming centers on the
point under the pointer. Rotation pivots around the point you are looking
at, so a detail stays in view while you inspect it.

Double-click, or press <kbd>0</kbd>, to reset the view to the full model.
Arrow keys pan the view. <kbd>Shift</kbd> with the arrow keys rotates it.
<kbd>+</kbd> and <kbd>-</kbd> zoom.

On a touchscreen, one finger orbits the model, the same as a left-button
drag. Two fingers switch to panning and pinch-zoom, the same gesture used on
the bed mesh map.

The chips in the corner of the view zoom, reset the framing, and save a
screenshot of the current view. The gear icon opens two settings:

- **Rotation pivot**: Sets whether rotation happens around the center of the
  view or the point under the pointer.
- **Snap to center**: Moves the point you grabbed to the center of the view
  as you start rotating.

## Replaying a file

**Start simulation** plays the file from the beginning at the speeds
specified in the file, at up to 20×, with a scrubber to jump to any point.
Simulation works without a printer connected. Use it to read a slice, check
where a long print spends its time, or find a problem before printing it.

During simulation, the selected color mode still applies: printed geometry
keeps its feature or feed-rate color, and the rest of the model shows as an
outline shell.

## Rendering quality

**Rendering quality** defaults to **Auto**. Auto measures the actual frame
time on your device and adjusts the level of detail to keep the view
responsive. It reduces geometry detail first, then sharpness. The active
layer of a running print always renders at full precision, regardless of
zoom level.

**Quality** renders at the highest detail level. Use it for screenshots.
**Performance** starts at the lowest detail level and increases it as the
device allows. Performance also renders extrusions as squares instead of
rounded shapes. This roughly doubles the frame rate when orbiting close to a
large model, and gives a zoomed-out model a calmer, more solid look, since
square extrusions have no curved surface to catch light. On a phone or a
Raspberry Pi's browser, use Auto or Performance mode to keep the view
responsive.

## Narrow screens

Below roughly 55 rem, the controls stack above the view and the page
scrolls as a single column. The viewer is available from the overflow menu
instead of the bottom bar, since it uses more device resources than a page
suited to a permanent slot.

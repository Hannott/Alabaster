# Print files

Everything on the printer, with the slicer's own data beside it, and one click to
start it.

Requires a registered `gcodes` file root. Without one the page is not shown.

## Browsing

Folders and files, sorted independently, with folders first. The breadcrumb walks
back up, and **Up one level** does the same in one step.

| Column   | Notes                                |
| -------- | ------------------------------------ |
| Name     | Folders first.                       |
| Size     |                                      |
| Modified | In your chosen date and time format. |

The list keeps itself current. Moonraker pushes a notification whenever a file
under the root is created, deleted, moved, or modified — from a slicer upload,
another tab, or a macro — and the list updates on its own. **Refresh list** is
there for the case where Moonraker's file watcher has been turned off.

## What a file tells you

Select a file to open its details. Everything the slicer wrote into it:

- **The preview image**, at full size.
- **Estimated time.**
- **Filament**, in metres and grams.
- **Layer height** and **object height.**
- **Nozzle diameter.**
- **Extruder, bed, and chamber temperatures** the file asks for.
- **Which slicer** produced it.

A file with no slicer data says so, rather than showing empty rows.

::: tip Mismatched filament
If Spoolman knows what is loaded, the detail panel warns when the file asks for a
different hot end temperature than the loaded filament is set for — before you
start it, not forty layers in.
:::

## Accurate estimates

**Get accurate estimate** runs Moonraker's own analysis over the file, rewriting
its time estimate and `M73` output using your printer's real motion limits.

Slicer estimates assume the slicer's idea of your machine. This uses the
machine's.

It is safe on a file that was already analysed on upload — Moonraker reports that
and changes nothing — so you never need to know in advance whether it was.

## Starting a print

**Print this file** starts it. It asks first, unless you have turned that
confirmation off.

The button is disabled while a print is running, and says why.

**Add to queue** puts it on Moonraker's job queue instead, to start when the
current job finishes.

## Uploading

**Upload** takes a file into the folder you are looking at.

Or drop one from your desktop onto the page. `.gcode`, `.g`, `.gco`, `.ufp`, and
`.nc` are accepted, and files land in the folder you are in rather than at the
root.

## Sending a file to the viewer

Any file here can be opened in the [G-code viewer](/interface/gcode-viewer) to
inspect its layers and toolpath before you commit filament to it. This is the
usual route in.

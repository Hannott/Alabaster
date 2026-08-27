# Print files

Print files lists everything stored on the printer, shows the slicer's own
data for each file, and starts a print in one click.

Requires a registered `gcodes` file root. Without one the page is not shown.

## Browsing

Folders and files, sorted independently, with folders first. The breadcrumb
walks back up the folder tree, and **Up one level** does the same in one step.

| Column   | Notes                                |
| -------- | ------------------------------------ |
| Name     | Folders first.                       |
| Size     |                                      |
| Modified | In your chosen date and time format. |

The list stays current on its own. Moonraker sends a notification whenever a
file under the root is created, deleted, moved, or modified, whether from a
slicer upload, another tab, or a macro, and the list updates automatically.
Use **Refresh list** if Moonraker's file watcher has been turned off.

## What a file tells you

Select a file to open its details, showing everything the slicer wrote into
it:

- **The preview image**, at full size.
- **Estimated time.**
- **Filament**, in metres and grams.
- **Layer height** and **object height.**
- **Nozzle diameter.**
- **Extruder, bed, and chamber temperatures** the file asks for.
- **Which slicer** produced it.

A file with no slicer data says so, instead of showing empty rows.

::: tip Mismatched filament
If Spoolman knows what is loaded, the detail panel warns when the file asks
for a different hot end temperature than the loaded filament is set for. It
warns before the print starts.
:::

## Accurate estimates

**Get accurate estimate** runs Moonraker's own analysis over the file,
rewriting its time estimate and `M73` output using your printer's real motion
limits.

Slicer estimates assume the slicer's idea of your machine. This uses the
machine's.

It is safe to run on a file that was already analysed on upload. Moonraker
reports this and changes nothing, so there is no need to check in advance.

## Starting a print

**Print this file** starts it. It asks first, unless you have turned that
confirmation off.

The button is disabled while a print is running, and shows why.

**Add to queue** puts it on Moonraker's job queue instead, to start when the
current job finishes.

## Uploading

**Upload** takes a file into the folder you are looking at.

Or drag one from your desktop onto the page. `.gcode`, `.g`, `.gco`, `.ufp`,
and `.nc` are accepted, and files land in the folder you are in rather than at
the root.

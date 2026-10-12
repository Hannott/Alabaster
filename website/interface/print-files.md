# Print files

Print files lists the prints stored on the printer with the slicer's picture,
time, and filament for each, keeps the print queue beside them, and starts a
print in one click.

Requires a registered `gcodes` file root. Without one the page is not shown.

## Finding a file

Files are grouped by when they were sliced: Today, Yesterday, Earlier this
month, then by month, newest first. Sort by **Name** or **Size** instead, and
press the active sort again to reverse it.

Each row shows how long the print takes, how much filament it uses, and the
material's colour and type, so you can pick a print that suits the loaded
spool without opening anything.

**Search files** narrows the folder you are in by name. Inside a folder, the
card's title shows the path; select any part of it to go back up.

The thumbnail folder slicers leave beside your files is not listed.

Moonraker sends a notification whenever a file under the root is created,
deleted, moved, or modified, whether from a slicer upload, another tab, or a
macro, and the list updates automatically. Use **Refresh list** if
Moonraker's file watcher has been turned off.

## What a file tells you

Select a file to open it beneath its row, showing everything the slicer wrote
into it:

- **The preview image**, at full size.
- **Print time**, filament in metres and grams, and the material.
- **Layer height** and **object height.**
- **The temperatures** the file asks for.
- **Which slicer** produced it, and for which nozzle.
- **When it last printed**, and whether that print completed.

A file with no slicer data says so, instead of showing empty rows. Select the
open file again to close it.

::: tip Mismatched filament
If Spoolman knows what is loaded, the open file warns before the print starts
when it asks for a different hot end temperature than the loaded filament is
set for, or when the spool has less left than the file needs.
:::

## Accurate estimates

**Get accurate estimate** runs Moonraker's own analysis over the file,
rewriting its time estimate and `M73` output using your printer's real motion
limits.

Slicer estimates assume the slicer's idea of your machine. This uses the
machine's.

It is safe to run on a file that was already analyzed on upload. Moonraker
reports this and changes nothing.

## Starting and queueing

**Print this file** starts it, from beneath the open file or from a row's
**⋯** menu without opening it. It asks first, unless you have turned that
confirmation off.

Printing is disabled while a print is running, and says why.

**Add to queue** puts it on Moonraker's job queue instead, to start when the
current job finishes. The queue sits beside the files, above them on a narrow
screen: start or pause it, remove a job, or clear it from its menu.

## Uploading

**Upload** takes a file into the folder you are looking at.

Drag a file from your desktop onto the file list instead. `.gcode`, `.g`,
`.gco`, `.ufp`, and `.nc` are accepted, and files land in the folder you are
in rather than at the root.

# Configuration

A real editor for `printer.cfg` and everything it includes, in a split view that
keeps the file tree beside what you are editing.

Requires `config_path` to be set in `moonraker.conf`. Without it the page is not
shown.

Switch between the **Config** and **Logs** roots at the top. Available
configuration storage is shown with them.

## Your edits survive everything but a reload

Every file you edit gets its own buffer, keyed by path and kept for as long as the
tab stays open. Open another file, walk into another folder, close the editor,
leave for the dashboard and come back — the edit is still exactly where you left
it, and Alabaster never asks whether you meant to keep it. Saving the file, or
**Discard changes**, is the only thing that clears one.

That means an unsaved edit can sit somewhere you are not looking, so it is marked
the whole way up to you: on the file's row, on every folder above it at any depth,
and on the Configuration entry in both the desktop sidebar and the mobile bar —
from whatever page you happen to be on, with a badge dot so it never depends on
colour alone.

**Save all** and **Discard all** handle the whole set at once, and both list every
file they will touch before doing it.

## printer.cfg reads like hypertext

`[include]` targets are links. Hovering underlines the path, Ctrl+click opens it.

![Hovering an include target shows a "Ctrl+click to open" tooltip and underlines the path](/images/configuration/include-link-hover.png)

A target that does not exist yet gets a wavy underline and an offer to create it —
along with its folder, if that is missing too — so a configuration you are still
assembling can be built downward from its include list. Globs are left alone, and
so is any path that would climb out of the configuration root.

![A missing include target is underlined with a wavy line](/images/configuration/include-missing-underline.png)

![A dialog offers to create the missing file so it can be edited](/images/configuration/create-missing-file-dialog.png)

**File structure** lists every `[section]` in the open file with its line number.
**File history** steps back and forward through the last ten files you opened, and
the last file you edited is named on the explorer so picking up where you left off
is not a hunt.

## Moving a file will not quietly break Klipper

Move a file that `printer.cfg` includes and that include now points at nothing —
enough on its own to stop Klipper from starting. Alabaster notices and offers to
rewrite the line: move and update, just move, or don't move. It never edits your
configuration behind your back. A glob include is left alone, since it may still
cover the file.

![A dialog asks whether to update the include line to the file's new path, just move it, or not move it](/images/configuration/move-and-update-dialog.png)

The row menu can also add or remove an include for you, and files that
`printer.cfg` already includes are marked in the list.

![A file's row menu with Rename, Download, Remove from printer.cfg, and Delete](/images/configuration/row-context-menu.png)

## The editor knows what it is reading

Four tokenizers, picked by extension, and the active line's number is highlighted
in the gutter:

| Format                           | Files              | Highlights                                                                                                                            |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Klipper configuration and macros | everything else    | Sections, keys, values, booleans, pin names, Jinja templates and their comments, `[include]` paths, and `SAVE_CONFIG` autogen markers |
| JSON                             | `.json`            | Object keys apart from string values, numbers, and literals                                                                           |
| Markdown                         | `.md`, `.markdown` | Headings, emphasis, inline code, and links                                                                                            |
| G-code                           | `.gcode`, `.nc`    | Command codes, parameters, numbers, and comments                                                                                      |

Images open in their own viewer with zoom: `png`, `jpg`, `gif`, `webp`, `bmp`,
`svg`, `ico`, `avif`.

The editor can be **maximized** over the explorer or taken **fullscreen** when a
file deserves the whole screen.

::: tip No file-type gate
A file Alabaster cannot place as text or image can still be opened, as can a text
file over 2 MB or an image over 20 MB — it asks first instead of refusing outright.
:::

**Save and restart** — if the file you are saving is the only one with unsaved
edits, it saves and restarts straight away; if others are unsaved, it asks to save
them too and names them, rather than restarting around an edit that exists only in
memory.

## Finding a file

**Search covers every file under the root**, not the folder you happen to be
standing in.

Turn on **Search in files** and it matches file contents as well as names — so
looking for the file that sets `rotation_distance` is a search rather than an
archaeology exercise.

Three switches under **Explorer settings** decide what the list shows at all:

| Setting              | Default | Hides                                                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Show hidden files    | Off     | Names starting with a dot                                                                                  |
| Show backup files    | Off     | `.bak`, `.bkp`, a trailing `~`, and any name containing "backup" — Klipper's `SAVE_CONFIG` output included |
| Show read-only files | **On**  | Nothing by default                                                                                         |

Folders and files sort independently of each other, with folders always first.

## The list watches itself

Moonraker pushes a notification whenever a file under a watched root is created,
deleted, moved, or modified — from another tab, a macro, or Klipper's own
`SAVE_CONFIG` — and the folder list updates on its own, without polling.

That depends on Moonraker's own file-system watcher, which a `moonraker.conf`
setting can turn off. **Refresh** in the toolbar is what's left when it isn't
running.

## Dragging, and what refuses it

Dragging works in both directions. A row dragged onto a folder or onto `..` moves
there. Files dragged in from your desktop upload into the folder row you drop them
on, not into whichever folder happens to be open.

What refuses a drag is decided per entry, not per folder: a read-only file cannot
be dragged and its Rename and Delete are disabled, and a read-only folder will not
accept a drop. Moonraker would refuse every one of those operations — Alabaster
says so before you attempt it.

## Save new config

When Klipper is holding changes from a `SAVE_CONFIG`, the header offers to save
them, and it summarises what is being held rather than asking you to trust it:

- **Probe offset**
- **Heater model · 6 settings**
- **Mesh · 121 points**

Saving writes them into `printer.cfg` and restarts Klipper. Discarding restarts
without them.

::: warning During a print
Both actions restart Klipper, which would end a running print. So both wait until
the print finishes rather than offering to interrupt it, and the dialog says so.
:::

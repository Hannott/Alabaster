# Configuration

Configuration is an editor for `printer.cfg` and everything it includes. Open
files sit in tabs on the left, and the file tree sits on the right.

Requires `config_path` to be set in `moonraker.conf`. Without it, the page
does not appear.

Switch between the **Config** and **Logs** roots at the top. The header shows
available configuration storage next to them.

## Quick config

**Quick config** changes Klipper options without finding the line they live
on. Each pinned option is a field, grouped into one card per section.

Alabaster reads `printer.cfg` and every file it includes in the same order
Klipper does, and edits the line Klipper actually uses. When a section is
split across files, or an option is set twice, the later definition is the one
that changes. An option still at its default shows Klipper's value, and
editing it adds the line to the section.

Quick config and the file editor share the same unsaved changes. An edit in
one shows as unsaved in the other, and saving from either writes both.

- **Original value** appears under a field you changed, with a button that
  reverts just that field.
- **Restart to apply** appears when the file holds a value Klipper has not
  loaded yet.
- The popout button opens the file at the option's line.

A value in the `SAVE_CONFIG` block at the end of `printer.cfg` can only be
saved together with a restart. Klipper rewrites that block from memory the
next time it saves, which would otherwise undo the change.

Some fields cannot be edited here, and say why:

- The value spans several lines. Edit it in the file.
- Klipper holds unsaved calibration results for it. Save or discard those
  first.
- Klipper does not read the option at all. Adding it would stop Klipper from
  starting.

**Save and restart** is not available during a print.

When a saved change has not been loaded yet, **Waiting for a restart** lists
it, for every option in your configuration and not only pinned ones, with the
value Klipper runs and the value in the file. **Klipper warnings** shows the
deprecation warnings Klipper found while loading, which it otherwise only
writes to its log.

**Add option**, or the edit button on a card, lists every option a section
has, including the ones still at their default. Click an option to put it on
the card or take it off, and drag to set the order the card shows them in.

The pinned options are saved per printer and included in settings sync and
backups. On first use, Quick config shows common limits, bed mesh, leveling,
input shaper, pressure advance, and retraction options, limited to the ones
your configuration has. A pinned section that is later removed from the
configuration stays as a card until you unpin it.

## Working with several files

Every file you open gets a tab, so `printer.cfg` and the files it includes can
be open side by side in one row. Switching tabs shows the file straight away.

A single click in the tree opens the file in a **preview tab**, drawn with a
dashed outline. The next single click replaces it, so browsing leaves one tab
behind instead of one per file. Double-click the file or the tab, or edit it,
to keep it. Following an `[include]` and stepping through file history also
open a preview.

Tabs that do not fit wrap onto more rows. Scroll down over the tabs to show
every row, and scroll up to fold them back to one, with a count of the tabs
that are folded away. The arrow button beside the tabs does the same, and the
menu next to it lists every open file. The file you are looking at is never
folded away.

Each tab has a pin and a close button that show on hover. A middle click
closes a tab, and so does Delete on a focused tab. Right-click a tab to close
the others, close every unpinned tab, or reveal the file in the tree.

The tree follows the file you have open and opens the folders above it. Hide
the tree with the button at the end of the tab row when you want the width
for the file.

Config and Logs each keep their own tabs, and switching back brings them
back.

## Unsaved changes

Each file you edit gets its own buffer, keyed by its path. The buffer stays
open for as long as the browser tab stays open. Open another file, switch
folders, close the file's tab, or leave for the dashboard: the edit is still
there when you come back. Alabaster does not ask whether to keep it.

Saving the file, or clicking **Discard changes**, is the only way to clear a
buffer.

Alabaster marks an unsaved edit on the file's tab and row, on every folder
above it at any depth, and on the Configuration entry in the desktop sidebar
and the mobile bar, from whatever page you are on. The marker is a badge dot, so it
does not depend on color alone.

**Save all** and **Discard all** act on every unsaved file at once. Both list
the files they will touch before doing it.

## Include links

`[include]` targets are links. Hovering underlines the path. Ctrl+click opens
it.

A target that does not exist yet gets a wavy underline and an offer to create
it, along with its folder if that is missing too. This lets you build a
configuration downward from its include list. Alabaster leaves globs alone,
along with any path that would climb out of the configuration root.

**File structure** lists every `[section]` in the open file with its line
number. Your mouse's back and forward buttons, or Alt+Left and Alt+Right, step
through the last ten files you opened.

## Moving included files

Moving a file that `printer.cfg` includes breaks that include, which is
enough on its own to stop Klipper from starting. Alabaster detects this and
offers to rewrite the line: move and update, just move, or don't move. It
never edits your configuration without asking. Alabaster leaves a glob
include alone, since it may still cover the file.

The row menu can also add or remove an include. The list marks files that
`printer.cfg` already includes.

## Syntax highlighting

A single syntax highlighter covers Klipper configuration and macros:
sections, keys, values, booleans, pin names, Jinja templates and their
comments, `[include]` paths, and `SAVE_CONFIG` autogen markers. It applies to
`.cfg`, `.conf`, `.cnf`, `.ini`, `.toml`, and `.bkp` files. The gutter
highlights the active line's number.

Every other file type, including `.json`, `.md`, and `.gcode`, opens as plain
text. Klipper's grammar does not describe these formats, and applying it
would invent structure that is not there. These are also often the largest
files, where highlighting is most expensive.

Images open in their own viewer with zoom: `png`, `jpg`, `gif`, `webp`,
`bmp`, `svg`, `ico`, `avif`.

Take the editor **fullscreen** with the button beside the tabs. Esc leaves
fullscreen.

::: tip No file-type gate
Alabaster still opens a file it cannot place as text or image, a text file
over 2 MB, or an image over 20 MB. It asks for confirmation first instead of
refusing.
:::

## Line editing commands

| Command                  | Shortcut                      |
| ------------------------ | ----------------------------- |
| Toggle comment           | Ctrl/Cmd+/                    |
| Move line up / down      | Alt+Up / Alt+Down             |
| Duplicate line up / down | Shift+Alt+Up / Shift+Alt+Down |
| Reindent the whole file  | Shift+Alt+F                   |
| Indent / outdent         | Tab / Shift+Tab               |

These commands act on the config formats the syntax highlighter understands.
Each one assumes something about Klipper's format: `#` as the comment
marker, and its continuation-line indentation. A plain-text file was never
written to that format.

The full reference of every editor shortcut opens from the help button
beside the tabs, or with Ctrl/Cmd+?. Save, Save and restart, and Discard
changes sit next to it.

**Save and restart** saves the current file and restarts Klipper. If it is
the only file with unsaved edits, this happens immediately. If other files
also have unsaved edits, Alabaster asks to save them too, and names them, so
no edit stays only in memory when Klipper restarts.

## Finding a file

**Search covers every file under the root**, not just the folder you are
standing in.

Turn on **Search in files** to match file contents as well as names. This
lets you find the file that sets `rotation_distance` by searching, instead of
opening files one at a time.

Opening a file while a search is active highlights every match inside it —
the line and the exact word — so you land on why it matched instead of
rereading the whole file to find it.

Three switches under **Explorer settings** decide what the list shows:

| Setting              | Default | Hides                                                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Show hidden files    | Off     | Names starting with a dot                                                                                  |
| Show backup files    | Off     | `.bak`, `.bkp`, a trailing `~`, and any name containing "backup", including Klipper's `SAVE_CONFIG` output |
| Show read-only files | **On**  | Nothing by default                                                                                         |

Folders and files sort independently of each other, and folders always come
first. **Sort by** under Explorer settings orders them by name, by size with
the largest first, or by date with the newest first.

The bar under the tree shows the size and modified date of the file or folder
you last selected.

Turn on **Compact rows**, also under Explorer settings and on by default, for
shorter rows and smaller icons — closer to a desktop file manager's list view,
so more of a large folder fits on screen at once.

Folders open in place in the tree. The arrow keys move through it: Right opens
a folder, Left closes it or steps out to the folder above. **Collapse all**
closes every folder at once.

## Pinning files

Pin a file from its tab or its row menu to keep its tab in a row of its own,
above the other tabs, until you unpin it. Pinned tabs come back the next time
you open Configuration, which makes them a shortcut for the handful of files
you return to constantly, wherever they live in the tree.

Closing a pinned tab unpins it. Renaming, moving, or deleting the file, or a
folder it lives in, carries the pin along or drops it, so a pin never points
at a path that no longer exists.

Pins stay in this browser rather than syncing to the printer.

## Automatic list updates

Moonraker sends a notification whenever a file under a watched root is
created, deleted, moved, or modified, whether from another tab, a macro, or
Klipper's own `SAVE_CONFIG`. The tree updates on its own, every open folder
included, without polling.

This depends on Moonraker's own file-system watcher, which a `moonraker.conf`
setting can turn off. Use **Refresh** in the toolbar if the watcher is not
running.

## Drag and drop

Dragging works in both directions. A row dragged onto a folder moves there,
and onto the root at the top of the tree moves it out of its folder. Files
dragged in from your desktop upload into the folder row you drop them on.
Dropped anywhere else in the tree, they go into the folder you last selected.

Alabaster decides whether a drag is allowed per entry, not per folder. A
read-only file cannot be dragged, and Alabaster disables its Rename and
Delete. A read-only folder will not accept a drop. Moonraker would refuse
every one of these operations; Alabaster says so before you attempt it.

## Save new config

The header offers to save changes Klipper is holding from a `SAVE_CONFIG`,
and shows a summary of what is being held:

- **Probe offset**
- **Heater model · 6 settings**
- **Mesh · 121 points**

Saving writes them into `printer.cfg` and restarts Klipper. Discarding
restarts without them.

::: warning During a print
Both actions restart Klipper, which would end a running print. Both wait
until the print finishes instead of offering to interrupt it, and the dialog
states this.
:::

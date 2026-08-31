# Farm

Every printer you have saved, on one screen: what each one is doing, a live
camera, temperatures, filament, and what it will print next. Pause a job, hold a
queue, or stop a machine without leaving the page.

Farm appears in the sidebar once you have saved **two or more printers**. On a
single-printer install it is not there at all. With multiple printers, turn
it off from [Settings → Printers](/guide/printers#seeing-them-all-at-once)
to work one machine at a time.

## The rail

Printers sit side by side in one row that scrolls sideways. Five fit on a
1920-wide screen with the next one part way on. Adding more never reshapes the
ones already on screen; they extend to the right. The row scrolls; the page
does not. Use the scrollbar, drag, or click the rail and use <kbd>←</kbd> and
<kbd>→</kbd>. <kbd>Home</kbd> and <kbd>End</kbd> jump to either end.

Printers stay in the order you arranged them in
[Settings → Printers](/guide/printers). Nothing re-sorts itself when a print
finishes, so a machine is always where you last saw it.

## Two sizes

Every printer starts **collapsed**, showing everything about that machine:
state, camera, progress, hotend and bed, filament, its queue, and the controls
that act on it.

The chevron beside the name **expands** it, which adds the print preview from
your slicer and the two queue controls. Expanding one printer costs a little
under the space of one other, and you can expand as many as you like. Alabaster
remembers which ones you left open, and the column you expand stays exactly
where it is on screen.

Expanding never changes what Alabaster is connected to. It is instant and
never interrupts anything.

::: tip Three levels, not two
Collapsed runs the machine. Expanded also runs its queue and shows what it is
printing. **Switch** points Alabaster at that printer without taking you
anywhere, and **Go to dashboard** is how you leave for its macros, movement and
calibration.
:::

## What you can do from a column

A collapsed column already carries every control that acts on the machine,
including an emergency stop in its top corner, for machines you are watching
rather than driving.

| Control                | What it does                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Pause** / **Resume** | The running print.                                                                                                        |
| **Cancel**             | Ends it. Asks first, naming the printer and the file.                                                                     |
| **Home** / **X Y Z**   | Homes every axis, or one. Not offered while a job is loaded: homing Z would drive the nozzle into whatever is on the bed. |
| **Cooldown**           | Turns off the heaters.                                                                                                    |
| **Files**              | Browses that printer's files without leaving the page. Queue one, or start it if the machine is idle.                     |
| **Hold queue**         | Expanded only. Lets the current print finish and stops the next one starting.                                             |
| **Start queue**        | Expanded only. Releases a held queue.                                                                                     |
| **Remove next**        | Expanded only. Drops the job at the head of the queue.                                                                    |
| **Power**              | The printer's own switch, where Moonraker has one configured.                                                             |
| **Switch**             | Points Alabaster at that printer. You stay on the Farm page; the column marks itself as the one being driven.             |
| **Go to dashboard**    | Leaves for that printer's dashboard. Shown on the card Alabaster is already driving.                                      |

Everything else (jogging, sending a macro, editing a configuration) is a
**Switch** and a **Go to dashboard** away, on a page built for it.

## Queues and files

Each column shows its printer's queue: how many jobs, whether the queue is
running or held, and the files in the order they will run.

**Files** opens that printer's own file list in place. Search it, then add a
file to the queue. On a machine with nothing loaded, start it straight away.
Alabaster asks before starting a print on a machine you are not standing at,
and names it.

For everything else a file needs (thumbnails, slicer data, uploading,
deleting), **Switch** to the printer and use
[Print files](/interface/print-files).

## When a printer is not answering

A column keeps showing what it last knew, dimmed, rather than emptying. The
state says which case it is:

- **Offline**: it answered before and does not now. Alabaster retries every 30
  seconds, or use **Retry now**.
- **Not reached**: nothing has ever answered at that address from this browser.
- **Refused**: the printer answered, but does not accept this page's address.
  Add it to `cors_domains` in `moonraker.conf`; see
  [Connecting to Moonraker](/guide/connecting).

## Cameras and bandwidth

Every column streams its camera at the frame rate you set for an idle view, and
a column scrolled out of the rail stops streaming entirely. Leaving the page, or
switching to another browser tab, disconnects every printer on it. Nothing keeps
running in the background.

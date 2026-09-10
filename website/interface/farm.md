# Farm

Every printer you have saved, on one screen, each with a camera big enough to
judge a print by. See what every machine is doing, then pause a job, drop a
queued one, or stop a machine — without leaving the page or switching which
printer Alabaster is driving.

Farm appears in the sidebar once you have saved **two or more printers**. On a
single-printer install it is not there at all. With multiple printers, turn
it off from [Settings → Printers](/guide/printers#seeing-them-all-at-once)
to work one machine at a time.

## How many you see at once

Cards fill the window and wrap down the page, which scrolls. A 1920-wide screen
gets three across — six cards visible, each with a 570 × 320 camera — and a
wider one gets four. Below 1700 pixels you get two, and a narrow window or a
phone gets one card at a time, full width.

Printers stay in the order you arranged them in
[Settings → Printers](/guide/printers). Nothing re-sorts itself when a print
finishes, so a machine is always where you last saw it, and adding a printer
adds a card without moving the others.

## What a card tells you

Under the name and address: the camera, then one line for what the machine is
doing — the state, the file, the layer it is on, how far through it is and how
long is left. Progress runs along the bottom edge of the picture. Below that,
hotend and bed temperatures, the filament loaded, and how many jobs are queued.

A printer with no camera configured shows the print's own preview from your
slicer instead. A printer with more than one camera gets a picker in the corner
of the picture, and remembers which one you chose. Hovering the picture offers a
snapshot and fullscreen.

The card Alabaster is currently driving is marked **Active**. A reachable
machine sitting idle with unhomed axes says **Not homed**.

## What you can do from a card

The emergency stop is in every card's top corner, for machines you are watching
rather than driving. **Pause** or **Resume** and **Cancel** are on the card
itself. Everything else is behind the **⋯** menu.

| Control                | What it does                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Pause** / **Resume** | The running print.                                                                                               |
| **Cancel**             | Ends it. Asks first, naming the printer and the file.                                                            |
| **Home all axes**      | Not offered while a job is loaded, paused included: homing Z would drive the nozzle into whatever is on the bed. |
| **Cooldown**           | Turns off the heaters.                                                                                           |
| **Power**              | The printer's own switch, where Moonraker has one configured.                                                    |
| **Files**              | That printer's files and its queue, in place.                                                                    |
| **Hold queue**         | Lets the current print finish and stops the next one starting.                                                   |
| **Start queue**        | Releases a held queue.                                                                                           |
| **Remove next job**    | Drops the job at the head of the queue.                                                                          |
| **Retry now**          | On a card that is not answering.                                                                                 |
| **Switch**             | Points Alabaster at that printer. You stay on the Farm page; the card marks itself **Active**.                   |
| **Go to dashboard**    | Leaves for that printer's dashboard. Shown on the card Alabaster is already driving.                             |

Everything else (jogging, sending a macro, editing a configuration) is a
**Switch** and a **Go to dashboard** away, on a page built for it.

## Queues and files

**Files** opens that printer's own file list in place. Search it, then add a
file to the queue. On a machine with nothing loaded, start it straight away.
Alabaster asks before starting a print on a machine you are not standing at,
and names it.

The second tab of the same dialog is that printer's **queue**: the jobs in the
order they will run, whether the line is held, and the controls to hold it or
drop what is next.

For everything else a file needs (thumbnails, slicer data, uploading,
deleting), **Switch** to the printer and use
[Print files](/interface/print-files).

## When a printer is not answering

A card keeps showing what it last knew, dimmed, rather than emptying. The
state says which case it is:

- **Offline**: it answered before and does not now. Alabaster retries every 30
  seconds, or use **Retry now**.
- **Not reached**: nothing has ever answered at that address from this browser.
- **Refused**: the printer answered, but does not accept this page's address.
  Add it to `cors_domains` in `moonraker.conf`; see
  [Connecting to Moonraker](/guide/connecting).

## Cameras and bandwidth

Every visible card streams its camera at the frame rate you set for an idle
view, and a card scrolled off the page stops streaming entirely. Leaving the
page, or switching to another browser tab, disconnects every printer on it.
Nothing keeps running in the background.

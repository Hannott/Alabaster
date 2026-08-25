# FAQ

## Does it replace my current interface?

No. Alabaster is a static site on its own address and it changes nothing about
Klipper or Moonraker. Run it alongside whatever you use now, on a different port,
and switch back whenever you like.

## Does anything run on my printer?

No. There is no Alabaster process, no database, and no scheduled job. Your web
server serves a folder of files, and the browser does the rest.

## Where are my settings stored?

In your browser's local storage, on the device you are using. By default nothing
is written to the printer, so another browser or another device starts fresh.

Turn on **Sync settings and layout to this printer** under
[Settings → Backup and sync](/interface/settings#sync-to-this-printer) and your
settings and that printer's dashboard are kept in the printer's own Moonraker
database instead, so every device sees the same setup. It is off until you ask
for it, and switched on per printer. Your list of printers stays in the browser
either way.

## Why can it not reach my printer?

Two different failures, and Alabaster tells them apart:

- **"Moonraker could not be reached"** — nothing answered. Check the address, the
  port, and whether the printer is on.
- **"Something answered, but refused the connection"** — Moonraker is running and
  turned your browser away. Add your browser's address to `cors_domains` in
  `moonraker.conf` and restart Moonraker.

[Connecting to Moonraker](/guide/connecting#letting-your-browser-reach-moonraker)
has the details.

## A page I expect is missing from the navigation

That is deliberate. Pages that need something your Moonraker does not have are
not shown at all, rather than shown empty:

| Missing page  | What it needs                          |
| ------------- | -------------------------------------- |
| Print files   | A registered `gcodes` file root.       |
| History       | Moonraker's `history` component.       |
| Timelapse     | The timelapse component installed.     |
| Configuration | `config_path` set in `moonraker.conf`. |

The Spool dashboard module works the same way, and needs Spoolman.

## Why did the page not reload when Klipper restarted?

Because it never does. Restarts are handled in place: the screen stays mounted,
values dim while they are stale, and fresh data crossfades back when
subscriptions rebuild.

You do not lose your scroll position, your open file, or your half-typed command.

## I sent a command and the connection dropped. Was it sent?

Alabaster tells you it failed and does not send it again. A retried heater target
or a retried print start is not a safe guess to make on your behalf, so the retry
is yours.

## Why is the remaining time different from my slicer's?

Because you can choose what it is based on. **Print settings → Remaining time
from** offers the slicer's own `M73` output, the position in the file, filament
consumed, or the best available source.

Alabaster also compares the two and warns when the print drifts past a threshold
you set — `12% behind the slicer estimate`. [More on
Print](/interface/modules#print).

## The print says no slicer progress is being reported

Your slicer is not emitting `M73`. Turn it on in the slicer's output settings.
Without it, the file position is used instead, which is less accurate on prints
whose layers vary a lot in time.

## Can I use it on a phone?

Yes, and the layout is built for it. The dashboard keeps a **separate layout for
phone, tablet, and desktop** — different card order, columns, and visibility, but
the same card configuration.

Every page is verified down to 390 px, and neither the page nor a toolbar is
allowed to scroll sideways.

## The G-code viewer will not open

It needs WebGL 2. Nothing else in Alabaster does, so the rest of the interface
works normally on a device without it.

If it opens but stutters, set **Rendering quality** to Performance, which is the
difference between usable and stalled on a phone or the Pi's own browser.

## Do I have to install alabaster.cfg?

No. Alabaster works without it, and the controls that need it hide themselves
rather than failing.

Installing it gives you a pause that lifts and parks the nozzle instead of
leaving it on the print, the pause-at-layer controls, and load and unload
filament macros. [Macros](/guide/macros) covers what it does and how to tune it.

## I already use another interface's macro pack

Then leave `alabaster.cfg` out. Both define `PAUSE`, `RESUME`, and
`CANCEL_PRINT`, and Klipper refuses to start when a macro is defined twice.

The installer checks before it changes anything: it reads `printer.cfg` and
everything it includes, and if it finds a conflicting definition it tells you
which macro and which file, and does not add the include.

Alabaster's pause-at-layer controls work with that pack too — the macros are
named the same way.

## Can I edit printer.cfg from here?

Yes, on the [Configuration](/interface/configuration) page. It has syntax
highlighting, `[include]` targets as links, section navigation, and search across
every file rather than the folder you are standing in.

Unsaved edits survive navigating away and are flagged from wherever you are. Only
saving or discarding clears one.

## What happens to a `SAVE_CONFIG` I have not saved?

Klipper holds it and Alabaster shows a **Save new config** action that summarises
what is being held — a probe offset, a heater model, a mesh and its point count.

If a print is running, both saving and discarding would restart Klipper and end
it, so both wait until the print finishes rather than offering to interrupt it.

## Is there a way to turn off all the confirmation dialogs?

Yes. **Settings → Confirmations** lists every confirmation in the application,
grouped by area, each with its own checkbox — plus a global override for all of
them at once.

These are shared across every printer, since they are about how you work rather
than about a machine.

## Can I add a language?

Yes, and it takes no code. English is the source; a new language is a translation
file with the same keys. A test checks that every locale matches the English
schema with no empty messages.

## Can I add a theme?

Yes. One CSS file implementing every semantic colour token in light and dark, one
registry line, and a label in each translation file. It appears in the picker on
its own. [Theming](/theming#writing-your-own-pack) covers the constraints.

## How do I report a bug or ask for something?

Open an issue on [GitHub](https://github.com/Hannott/Alabaster). If it is about
something the printer said, the console's **Show Klipper's own prefixes** option
leaves the raw markers in place so you can copy a line verbatim.

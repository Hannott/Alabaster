# FAQ

## Does it replace my current interface?

No. Alabaster is a static site on its own address and changes nothing about
Klipper or Moonraker. Run it alongside your current interface, on a different
port, and switch back any time.

## Does anything run on my printer?

No. There is no Alabaster process, no database, and no scheduled job. Your web
server serves a folder of static files, and the browser renders them.

## Where are my settings stored?

In your browser's local storage, on the device you are using. By default nothing
is written to the printer, so another browser or another device starts fresh.

Turn on **Sync settings and layout to this printer** under
[Settings → Backup and sync](/interface/settings#sync-to-this-printer). Your
settings and that printer's dashboard then move to the printer's own Moonraker
database, so every device sees the same setup. It defaults to off and is set
per printer. Your list of printers stays in the browser either way.

## Why can it not reach my printer?

Two different failures, and Alabaster tells them apart:

- **"Moonraker could not be reached"**: nothing answered. Check the address, the
  port, and whether the printer is on.
- **"Something answered, but refused the connection"**: Moonraker is running and
  turned your browser away. Add your browser's address to `cors_domains` in
  `moonraker.conf` and restart Moonraker.

See [Connecting to Moonraker](/guide/connecting#letting-your-browser-reach-moonraker)
for more information.

## A page I expect is missing from the navigation

That is deliberate. Alabaster hides pages that need something your Moonraker
does not have, instead of showing them empty:

| Missing page  | What it needs                          |
| ------------- | -------------------------------------- |
| Print files   | A registered `gcodes` file root.       |
| History       | Moonraker's `history` component.       |
| Timelapse     | The timelapse component installed.     |
| Configuration | `config_path` set in `moonraker.conf`. |

The Spool dashboard module works the same way, and needs Spoolman.

## Why did the page not reload when Klipper restarted?

Alabaster never reloads for a restart. The screen stays mounted. Values dim
while they are stale. Fresh data crossfades back in once subscriptions
rebuild.

You do not lose your scroll position, your open file, or your half-typed
command.

The one exception is updating Alabaster itself: closing the update
transcript afterward reloads the page once, to load the new version.

## I sent a command and the connection dropped. Was it sent?

Alabaster tells you it failed and does not resend it. It does not guess
whether repeating a heater target or a print start is safe: retry it
yourself.

## Why is the remaining time different from my slicer's?

**Print settings → Remaining time from** sets the source: the slicer's own
`M73` output, the position in the file, filament consumed, or the best
available source.

Alabaster also compares the two and warns when the print drifts past a
threshold you set, for example `12% behind the slicer estimate`. See
[Print](/interface/modules#print) for more information.

## The print says no slicer progress is being reported

Your slicer is not emitting `M73`. Turn it on in the slicer's output settings.
Without it, Alabaster uses the file position instead. File position is less
accurate on prints whose layer times vary a lot.

## Can I use it on a phone?

Yes, and the layout is built for it. The dashboard keeps a **separate layout
for phone, tablet, and desktop**. Card order, columns, and visibility differ
by device, but the card configuration stays the same.

Every page is verified down to 390 px. Neither the page nor a toolbar scrolls
sideways.

## The G-code viewer will not open

It needs WebGL 2. Nothing else in Alabaster does, so the rest of the interface
works normally on a device without it.

If it opens but stutters, set **Rendering quality** to Performance. This
setting keeps the viewer usable on a phone or the Pi's own browser, where it
would otherwise stall.

## Do I have to install alabaster.cfg?

No. Alabaster works without it. Controls that need it hide themselves instead
of failing.

Installing it adds a pause that lifts and parks the nozzle instead of leaving
it on the print, plus the pause-at-layer controls and load and unload filament
macros. See [Macros](/guide/macros) for more information on what it does and
how to tune it.

## I already use another interface's macro pack

Then leave `alabaster.cfg` out. Both define `PAUSE`, `RESUME`, and
`CANCEL_PRINT`, and Klipper refuses to start when a macro is defined twice.

The installer checks before it changes anything. It reads `printer.cfg` and
everything it includes. If it finds a conflicting definition, it tells you
which macro and which file, and does not add the include.

Alabaster's pause-at-layer controls work with that pack too. The macros are
named the same way.

## Can I edit printer.cfg from here?

Yes, on the [Configuration](/interface/configuration) page. It has syntax
highlighting, `[include]` targets as links, section navigation, and search
across every file, not only the current folder.

Unsaved edits survive navigating away and stay flagged wherever you go. Only
saving or discarding clears the flag.

## What happens to a `SAVE_CONFIG` I have not saved?

Klipper holds it. Alabaster shows a **Save new config** action summarising
it, for example a probe offset, a heater model, or a mesh and its point
count.

If a print is running, saving or discarding would restart Klipper and end the
print. Both wait until the print finishes instead of interrupting it.

## Is there a way to turn off all the confirmation dialogs?

Yes. **Settings → Confirmations** lists every confirmation in the application,
grouped by area, each with its own checkbox. A global override turns off all
of them at once.

These settings are shared across every printer. They describe how you work,
not a specific machine.

## Can I add a language?

Yes, and it takes no code. English is the source. A new language is a
translation file with the same keys. A test checks that every locale matches
the English schema with no empty messages.

## Can I add a theme?

Yes. A new theme needs one CSS file implementing every semantic color token
in light and dark, one registry line, and a label in each translation file. It
appears in the picker automatically. See
[Theming](/theming#writing-your-own-pack) for more information.

## How do I report a bug or ask for something?

Open an issue on [GitHub](https://github.com/Hannott/Alabaster). If it is about
something the printer said, the console's **Show Klipper's own prefixes** option
leaves the raw markers in place so you can copy a line verbatim.

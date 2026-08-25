# Customizing the dashboard

Choose **Customize** on the dashboard to start arranging. Choose **Done** when
you have finished.

## Moving and resizing

Drag a card where you want it. Every drag action also has a button, so this works
with a keyboard and on a touchscreen:

| Action                 | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| Move earlier / later   | Reorders the card within its column.                        |
| Previous / next column | Moves it sideways.                                          |
| Hide                   | Takes it off this layout. It keeps its configuration.       |
| Collapse               | Keeps it in place, showing only its header and one reading. |

**Column widths** sets the shape of the grid: equal columns, one wide column, or
one narrow one. Pick which column it applies to.

Hidden cards are listed under **Available modules**, ready to put back.

## Three layouts, one configuration

The **Layout profile** switch — Desktop, Tablet, Mobile — is the important part.

Card order, column, width, visibility, and collapsed state are **stored per
profile**. Three columns on the desktop, two on a tablet, one on a phone, each
with its own arrangement.

A card's **configuration is shared** across all three. Set your temperature
presets on the desktop and your phone has them. Choose macros once.

::: tip Edit the profile you are using
Switching the layout profile switches which arrangement you are editing, not the
size of the window. Set up each one on the device you actually use it on, or
switch profiles and edit them from anywhere.
:::

**Reset this layout** restores the current profile's arrangement without touching
the other two.

## Presets

Three starting points, on the **Apply a preset** control:

| Preset   | Cards                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| Minimal  | Print, Camera, Temperatures, Movement                                        |
| Standard | Minimal plus Controls, Macros, Console, Activity                             |
| Tuning   | Print, Temperatures, Movement, Controls, Macros, Extruder, Bed mesh, Console |

A preset changes visibility only. Nothing you configured on a card is discarded,
so you can try one and go back.

## More than one of the same card

**Macros** and **Camera** can each appear as many times as you like. Every copy
is its own card with its own name and its own configuration.

The usual **Macros** arrangement is one card per job:

- **Preparation** — home, level, load filament. Shown while idle.
- **Mid-print** — pause at layer, purge, adjust. Shown while printing and paused.
- **Calibration** — PID tuning, test prints, resonance runs.

Each macro button can carry a colour from the Okabe-Ito palette, and each group
can be set to appear only while the printer is idle, paused, or printing.

The usual **Camera** arrangement is one card per subject — "the printer" tiled
from two angles, "the filament path" on its own — rather than every camera
stacked on one card. A camera already claimed by one card is not offered to
another, so nothing streams twice.

Use **Add another card** on the card's own controls, and **Remove this card** to
take one away.

## Configuring a card

Two ways in, and they lead to the same settings:

- **The gear** in the card header opens quick settings in place — the handful of
  switches that change what the card shows.
- **Ctrl+click the gear**, or choose **All settings**, opens the full pane with
  the live card docked beside it. Change a step size and watch the buttons change
  under it.

Settings you use often can be promoted onto the card. Settings you set once can
be pushed back into the full pane. The quick layer is yours to choose.

## What is remembered, and where

Everything is stored in your browser, keyed to the **printer's identity** rather
than its address.

So a printer reached at `printer.local`, at an IP address, and through a tunnel
is one printer with one dashboard — not three empty ones.

Two consequences:

- **Another browser or device starts fresh.** Each keeps its own layouts. When
  adding a second printer you can copy an existing printer's dashboard to skip
  the setup.
- **Removing a printer does not delete its dashboard.** Add it back and the
  arrangement returns.

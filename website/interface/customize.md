# Customizing the dashboard

Choose **Customize** on the dashboard to start arranging cards. Choose
**Done** when you are finished.

## Moving and resizing

Drag a card to move it. Every drag action also has a button, so moving and
resizing works with a keyboard and on a touchscreen:

| Action                 | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| Move earlier / later   | Reorders the card within its column.                        |
| Previous / next column | Moves it sideways.                                          |
| Hide                   | Takes it off this layout. It keeps its configuration.       |
| Collapse               | Keeps it in place, showing only its header and one reading. |

**Column widths** sets each column separately. Pick a column on the numbered
ruler, then choose XS, S, M, L, or XL. XS-XL-XS and L-S-S are both valid
combinations, and the ruler shows the shape you are making.

Each width has a ceiling of its own. Three XS columns stay narrow and sit
centred with space either side rather than stretching to fill a large monitor,
and an XL column keeps growing long after an XS one has stopped.

Hidden cards are listed under **Available modules**, ready to add back.

## Three layouts, one configuration

The **Layout profile** switch has three options: Desktop, Tablet, and Mobile.

Card order, column, width, visibility, and collapsed state are **stored per
profile**. Desktop uses three columns, tablet uses two, and phone uses one,
each with its own arrangement.

A card's **configuration is shared** across all three profiles. Set your
temperature presets on the desktop, and they appear on your phone too. Choose
macros once.

::: tip Edit the profile you are using
Switching the layout profile changes which arrangement you are editing. It
does not change the size of the window. Set up each profile on the device you
use it on, or switch profiles to edit any of them from any device.
:::

**Reset this layout** restores the current profile's arrangement. It does not
change the other two profiles.

## Presets

**Apply a preset** offers three starting points:

| Preset   | Cards                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| Minimal  | Print, Camera, Temperatures, Movement                                        |
| Standard | Minimal plus Controls, Macros, Console, Activity                             |
| Tuning   | Print, Temperatures, Movement, Controls, Macros, Extruder, Bed mesh, Console |

A preset changes visibility only. It does not discard any card's
configuration, so you can try a preset and switch back.

## More than one of the same card

**Macros** and **Camera** can each appear more than once. Each copy is its
own card, with its own name and its own configuration.

The usual **Macros** arrangement is one card per job:

- **Preparation**: home, level, load filament. Shown while idle.
- **Mid-print**: pause at layer, purge, adjust. Shown while printing and
  paused.
- **Calibration**: PID tuning, test prints, resonance runs.

Each macro button can have a colour from the Okabe-Ito palette. Each group
can be set to appear only while the printer is idle, paused, or printing.

The usual **Camera** arrangement is one card per subject: for example, "the
printer" tiled from two angles, and "the filament path" on its own, rather
than every camera stacked on one card. A camera already assigned to one card
is not offered to another, so no camera streams twice.

Use **Add another card**, in the card's own controls, to add a copy. Use
**Remove this card** to remove one.

## Configuring a card

There are two ways to open a card's settings, and both lead to the same
settings:

- **The gear** in the card header opens quick settings in place: a handful of
  switches that change what the card shows.
- **Ctrl+click the gear**, or choose **All settings**, to open the full pane
  with the live card docked beside it. Change a step size and see the buttons
  update under it.

Settings you use often can be promoted onto the card. Settings you set once
can be moved back into the full pane. You choose what appears in the quick
layer.

## What is remembered, and where

Everything is stored in your browser, keyed to the **printer's identity**
rather than its network address.

A printer reached at `printer.local`, at an IP address, and through a
tunnel is one printer with one dashboard, not three separate ones.

Two consequences:

- **Another browser or device starts fresh.** Each one keeps its own
  layouts. Copy an existing printer's dashboard to skip setup when you add
  a second printer.
- **Removing a printer does not delete its dashboard.** Add it back and the
  arrangement returns.

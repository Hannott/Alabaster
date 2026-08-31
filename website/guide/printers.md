# Several printers

Alabaster keeps a list of printers and switches between them from the header. One
connection is live at a time.

::: tip Run it off-printer
With more than one machine, serve Alabaster from a NAS, a spare box, or a
container rather than from one printer's Pi. Every printer is then equal, and the
interface stays up when any of them is off. See
[Installation](/guide/installation#choose-where-it-runs).
:::

## Adding one

**Settings → Printers → Add a printer.**

| Field     | What it does                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Address   | `printer.local:7125`, an HTTP address, or a full `ws://` address.                                                          |
| Name      | Optional. Leave it blank and the printer is shown by the name it reports for itself, or by its address if it reports none. |
| Dashboard | Start blank, or copy the dashboard from a printer you have already set up.                                                 |

Copying a dashboard suits a second machine of the same model. It brings the
layout, the modules, and their configuration, including temperature presets,
chosen macros, and step sizes. You set them up once.

## Switching

The printer menu is in the header, on every page. Picking one disconnects the
current printer and connects the new one.

The page does not reload. Modules dim, then fill with the new machine's data.

## Seeing them all at once

With two or more printers saved, the [Farm](/interface/farm) page appears in the
sidebar: every machine side by side, live, with the controls you need for the
one that wants attention. Switching stays where it is — the menu is one click
from every page, the Farm page is somewhere you go.

If you keep several printers but work on one at a time, turn **Show the Farm
page** off on this card and the sidebar entry goes away.

## What follows a printer, and what does not

Alabaster separates two kinds of settings.

**Per printer**: the dashboard, its modules and their configuration, macro
selections, temperature presets, step sizes, bed-mesh thresholds, and
maintenance intervals. A printer with a different bed, a different hot end,
and different macros gets its own settings.

**Shared across every printer**: language, time and date format, theme pack,
light or dark mode, typeface, text weight, and confirmation settings. These
settings belong to you, not to a machine.

## Identity, not address

Per-printer settings are keyed to the printer's own identity, not to the address
you reach it at.

A hostname, an IP address, and a tunnel can all reach the same printer. Keyed
to the address, each would appear as a separate printer with an empty
dashboard. Keyed to identity, they stay one printer with the dashboard you
built for it.

This means you can:

- Switch from `printer.local` to `192.168.1.42` without losing anything.
- Move the printer to a new hostname and keep its dashboard.
- Reach the same printer from home and from the workshop and get the same
  interface.

## Renaming and removing

Both are on the printer's row in **Settings → Printers**.

Removing a printer takes it out of the list. It does **not** delete what you
configured for it: add the same printer back and its dashboard, presets, and
intervals return.

## Where it is all stored

Alabaster stores this in your browser's local storage, on the device you are
using.

As a result, **another browser or another device starts fresh** unless you
turn on sync.

**Sync settings and layout to this printer**, under
[Settings → Backup and sync](/interface/settings#sync-to-this-printer), stores
your settings and that printer's dashboard in the printer's own Moonraker
database. A phone and a workshop tablet then see the same setup. It is off by
default; you switch it on per printer.

::: info The printer list itself never syncs
Your list of printers stays in the browser, even with sync on. The list
decides _which_ printer's database to read, so a printer cannot store the
answer to how it is found. The list is also the one setting that is genuinely
per-device: a phone on mobile data and a workshop tablet on the LAN may need
different addresses for the same machine.
:::

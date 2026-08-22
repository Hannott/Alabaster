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

| Field     | What it does                                                               |
| --------- | -------------------------------------------------------------------------- |
| Address   | `printer.local:7125`, an HTTP address, or a full `ws://` address.          |
| Name      | Optional. Leave it blank and the address is shown instead.                 |
| Dashboard | Start blank, or copy the dashboard from a printer you have already set up. |

Copying a dashboard is worth using for a second machine of the same model. It
brings the layout, the modules, and their configuration — temperature presets,
chosen macros, step sizes — so you set them up once.

## Switching

The printer menu is in the header, on every page. Picking one disconnects the
current printer and connects the new one.

The page does not reload. Modules dim, then fill with the new machine's data.

## What follows a printer, and what does not

Alabaster keeps two kinds of setting apart.

**Per printer** — the dashboard, its modules and their configuration, macro
selections, temperature presets, step sizes, bed-mesh thresholds, maintenance
intervals. A printer with a different bed, a different hot end, and different
macros needs different answers, and it gets them.

**Shared across every printer** — language, time and date format, theme pack,
light or dark mode, typeface, text weight, and the confirmation settings. These
are about you, not about a machine.

## Identity, not address

Per-printer settings are keyed to the printer's own identity, not to the address
you reach it at.

This matters more than it sounds. A hostname, an IP address, and a tunnel are
three addresses for one machine. Keyed on the address, that would be three
printers with three empty dashboards. Keyed on identity, it stays one printer
with the dashboard you built for it.

So you can:

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

Your browser's local storage, on the device you are using.

That has one consequence worth planning for: **another browser or another device
starts fresh** — unless you turn on sync.

**Sync settings and layout to this printer**, under
[Settings → Backup and sync](/interface/settings#sync-to-this-printer), keeps
your settings and that printer's dashboard in the printer's own Moonraker
database, so a phone and a workshop tablet see the same setup. It is off by
default and switched on per printer.

::: info The printer list itself never syncs
Your list of printers stays in the browser, even with sync on. It has to: the
list is what decides _which_ printer's database to read, so a printer cannot
hold the answer to how it is found. It is also the one thing that is genuinely
per-device — a phone on mobile data and a workshop tablet on the LAN may need
different addresses for the same machine.
:::

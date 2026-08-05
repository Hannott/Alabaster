# Alabaster

A modern, accessible web interface for Klipper and Moonraker — built to be
read from across a workshop and driven from a phone.

<!-- Screenshot goes here: docs/images/screenshot.png -->

- **Nothing here needs a reload.** Klipper, Moonraker, and firmware restarts
  are handled in place — values dim while stale and crossfade back.
- **Heater arrival times learned from your own machine** — a real ETA and a
  climb rate, not a countdown, plus a warning when a print falls behind the
  slicer's own estimate.
- **`printer.cfg` reads like hypertext.** `[include]` targets are clickable,
  moving a file offers to fix the include that pointed at it, and an unsaved
  edit is never lost to a wrong click.
- **A G-code viewer built for huge files.** A 100 MB print starts drawing in
  about a quarter second, and can follow a live job bead by bead along the
  real path rather than sliding between position samples.
- **Maintenance counted against the printer's own totals** — print hours,
  filament, or days since — and asked about before a print starts into an
  overdue one.
- **WCAG AA contrast enforced by a test**, on every control over every
  surface, not a guideline someone might follow. Full localization, theme
  packs, five typefaces including OpenDyslexic.

More of what's different: **[hannott.github.io/Alabaster/guide/highlights](https://hannott.github.io/Alabaster/guide/highlights)**

## Installation

On the machine running Klipper — not your workstation — as the user that owns
it, not root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hannott/Alabaster/main/scripts/install.sh)"
```

Downloads the latest release, verifies its checksum, and asks before every
change it makes outside its own directory. Then open
`http://<your-printer>.local:8081`.

Re-running the same command updates Alabaster. `bash ~/alabaster/scripts/uninstall.sh`
reverses it.

Full walkthrough, every flag, and the off-printer / multiple-printer
arrangement: **[hannott.github.io/Alabaster/guide/installation](https://hannott.github.io/Alabaster/guide/installation)**

## Documentation

The full guide — every page, theming, accessibility, keyboard shortcuts, and
a plain account of what isn't finished yet — lives at
**[hannott.github.io/Alabaster](https://hannott.github.io/Alabaster)**.

## Development

```bash
npm install
npm run dev
```

```bash
npm run check
```

`npm run check` is the gate before any pull request: formatting, linting,
type-checking, every test, and the production build.

Node.js 24.15+ (or 22.22.2+ within the 22.x line), a Docker Compose service
for a shared dev environment, and the documentation site's own build are
covered in the
[development guide](https://hannott.github.io/Alabaster/guide/development).

## Architecture and conventions

The conventions and design decisions this codebase follows — page layout, the
button system, dialogs, the dashboard module contract, the Moonraker
transport, theming, and deployment — are summarised in
[Contributing](https://hannott.github.io/Alabaster/contributing).

## License

[GNU GPLv3](LICENSE).

Every icon in [`AppIcon.vue`](src/components/AppIcon.vue) is hand-drawn or
redrawn from an MIT/Apache-2.0-licensed glyph, neither of which require
attribution. One exception: the Spoolman card's icon (the `spool` token) is
selfh.st's ["spoolman-light"](https://icon-sets.iconify.design/selfhst/spoolman-light/)
icon, © [selfh.st](https://selfh.st/icons/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Prior art

Alabaster's dashboard-module layout, its everyday-controls-first card
anatomy, and much of what it expects a Klipper front end to expose all trace
back to [Mainsail](https://github.com/mainsail-crew/mainsail) and
[Fluidd](https://github.com/fluidd-core/fluidd) — years of production use
against real printers settled most of what a Moonraker client needs to get
right, and Alabaster's own design docs were written against a survey of both.
What's deliberately not carried over is their implementation: Alabaster is a
from-scratch Vue 3 / Composition API codebase, not built on their Vue 2,
class-component, Vuex, or Vuetify architecture.

---
layout: home
hero:
  name: Alabaster
  text: A web interface for Klipper
  tagline: Watch, control, and tune your Klipper printers from any browser on the network. It works with one hand on a phone, or with three columns of information on a larger screen. It is fast and readable on every device.
  actions:
    - theme: brand
      text: Get started
      link: /guide/
    - theme: alt
      text: What makes it different
      link: /guide/highlights
    - theme: alt
      text: GitHub
      link: https://github.com/Hannott/Alabaster
features:
  - title: A dashboard you build
    details: Choose from fifteen modules and arrange them across up to three columns. Desktop, tablet, and phone each keep their own layout. Drag a module to reposition it, and duplicate any module you need more than once.
    link: /interface/customize
  - title: Nothing here needs a reload
    details: Alabaster handles Klipper, Moonraker, and firmware restarts without reloading the page. Values dim while they are stale, then return to normal once fresh data arrives. You keep your place on the page throughout.
    link: /guide/connecting
  - title: Heat-up times it learned from your printer
    details: The Temperatures module shows when a heater will reach its target, how fast its temperature is rising, and when it has stopped rising.
    link: /interface/modules#temperatures
  - title: printer.cfg that reads like hypertext
    details: Ctrl+click an [include] line to open that file. Create a missing file directly from the line that names it. If you move a file, Alabaster offers to update the include.
    link: /interface/configuration
  - title: A G-code viewer for big files
    details: A hundred-megabyte print file starts drawing within a quarter of a second. Follow a live print as it happens, or replay a section at 20x speed before you commit filament.
    link: /interface/gcode-viewer
  - title: Maintenance that counts for you
    details: Alabaster measures service intervals in print hours, metres of filament, or days, and warns you before you start a print that would run into an overdue one.
    link: /interface/modules#maintenance
  - title: Readable by contract
    details: Every control meets WCAG AA contrast on every surface. A test checks this and fails the build if contrast drops. Color never carries status alone.
    link: /accessibility
  - title: Themes, typefaces, and languages
    details: Alabaster includes theme packs with independent light and dark modes, five typefaces including OpenDyslexic, and full localization. English and Norwegian are both available.
    link: /theming
---

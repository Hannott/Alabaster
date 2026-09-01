# Accessibility

This page lists Alabaster's accessibility guarantees. An automated test
enforces each one, so it holds even when someone is in a hurry.

## Enforced by tests

| Guarantee                                                                                                       | Test                             |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Every control variant clears **4.5:1** contrast over every surface it can sit on, at rest, hovered, and pressed | `controlContrast.spec.ts`        |
| Chromatic color never leaves the Okabe-Ito palette, and no component carries a color literal                    | `palette.spec.ts`                |
| Every animation has a reduced-motion fallback                                                                   | `motion.spec.ts`                 |
| Every clickable control comes from one button system, and none of them move on hover or press                   | `interactionConsistency.spec.ts` |
| Every routed page uses one of two documented page shells                                                        | `pageLayout.spec.ts`             |
| Every locale matches the English schema, with no empty messages                                                 | `locales.spec.ts`                |
| Every theme pack implements the full token contract in both light and dark                                      | `themes.spec.ts`                 |

## Color

Chromatic color comes only from the
[Okabe-Ito palette](https://jfly.uni-koeln.de/color/). The palette stays
distinguishable across the common forms of color blindness. Neutral
variation uses only black and white with opacity.

Color never carries status alone. Text or a distinct shape always repeats
what a color says: a state, a warning, an unsaved file, or a disconnected
board. A status stays readable in greyscale, on a washed-out monitor, or to
someone who cannot see the hue at all.

Alabaster computes control colors from contrast requirements, not by eye. A
test composites each variant over each surface it can appear on and checks
the result.

## Motion

Every animation has a reduced-motion fallback. A test checks that each one
does.

With reduced motion set in your operating system:

- Crossfades and reveals become instant.
- The G-code viewer shows discrete position updates instead of a continuous
  toolhead path.
- You lose no information. Motion never carries information on its own.

Animation never delays input. A control responds when you press it, no
matter what is animating.

Alabaster never animates responsive geometry: grid tracks, pane widths,
table columns, folder contents. Layout changes appear immediately instead of
sliding into place.

## Keyboard

You can do every dragging action with buttons too. This covers the
dashboard's move, resize, and hide actions. Dragging is faster, but buttons
reach every action too.

- Skip to main content is the first item in the tab order.
- Focus rings use a themed token and appear on every focusable control.
- Menus, dialogs, and pickers close on <kbd>Escape</kbd> and return focus to
  where it came from.
- Dialogs are real HTML dialogs. `window.confirm`, `window.prompt`, and
  `window.alert` appear nowhere in the application.

See [Keyboard shortcuts](/shortcuts) for the shortcuts each page adds.

## Typefaces

Alabaster offers five typefaces. Choose one in
[Settings → Appearance](/interface/settings#appearance):

- OpenDyslexic is available. It isn't the default: it serves a specific
  need.
- Public Sans is the proportional option, for readers who find monospace
  interfaces harder to read.
- Text weight runs from Light to Bold. A screen read from two metres and a
  phone held at arm's length need different weights.
- The console has its own typeface and weight, independent of the interface
  setting.

Each option in the picker renders in its own typeface, so you can choose by
looking at it rather than by name.

## Text and language

Every string is translated, including accessible names, titles,
placeholders, validation messages, and notifications. No component
hardcodes user-facing text. Adding a new language requires only a
translation file.

Alabaster ships English and Norwegian Bokmål. A test fails the build if any
locale is missing a key or has an empty message, so a partially translated
release cannot ship.

Alabaster keeps time and date formats separate from language. You can read
the interface in one language and see the clock in the format you use.

## Layout

A test verifies every page at desktop width and at 390 px. Neither the page
nor a toolbar acquires horizontal scrolling. Wide content (tables, charts,
code) scrolls inside its own container.

Text is not selectable by default, so dragging across the interface does not
select it. Chrome also does not respond to a right-click. Surfaces where you
need to copy text (console output, update logs, file contents) opt in
explicitly.

## Screen wake lock

Settings → Display can hold the screen awake, for a shop-floor display.

Two limits apply. The wake lock holds only while the tab is in the
foreground, and it needs a secure context, so it is unavailable over a
plain LAN address.

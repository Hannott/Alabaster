# Accessibility

Most of this page is about promises that are kept by tests rather than by
intention. A guideline gets followed until someone is in a hurry. A test that
fails the build does not.

## Enforced by tests

| Guarantee                                                                                                        | Test                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Every control variant clears **4.5:1** contrast over every surface it can sit on — at rest, hovered, and pressed | `controlContrast.spec.ts`        |
| Chromatic colour never leaves the Okabe-Ito palette, and no component carries a colour literal                   | `palette.spec.ts`                |
| Every animation has a reduced-motion fallback                                                                    | `motion.spec.ts`                 |
| Every clickable control comes from one button system, and none of them move on hover or press                    | `interactionConsistency.spec.ts` |
| Every routed page uses one of two documented page shells                                                         | `pageLayout.spec.ts`             |
| Every locale matches the English schema, with no empty messages                                                  | `locales.spec.ts`                |
| Every theme pack implements the full token contract in both light and dark                                       | `themes.spec.ts`                 |

## Colour

**Chromatic colour comes only from the
[Okabe-Ito palette](https://jfly.uni-koeln.de/color/)**, which is designed to
stay distinguishable across the common forms of colour blindness. Neutral
variation is black and white with opacity, and nothing else.

**Colour never carries status alone.** Anything a colour says is also said in
text or a distinct shape — a state, a warning, an unsaved file, a disconnected
board. So a status is readable in greyscale, on a washed-out workshop monitor, and
by someone who does not see the hue at all.

**Contrast is derived, not judged.** Control colours are computed from contrast
requirements rather than picked because they looked right. The test composites
each variant over each surface it can appear on and checks the result.

## Motion

Every animation has a reduced-motion fallback, and the tests check that each one
does.

With **reduced motion** set in your operating system:

- Crossfades and reveals become instant.
- The G-code viewer's continuous toolhead path becomes discrete position updates.
- Nothing that conveys information is lost. Motion is never the only carrier.

Animation also never delays input. A control responds when you press it,
regardless of what is animating.

Responsive geometry is never animated at all — grid tracks, pane widths, table
columns, folder contents. Layout that slides while you are reading it is worse
than layout that arrives.

## Keyboard

Every action that can be done by dragging can also be done with buttons. The
dashboard's move, resize, and hide are the clearest case: dragging is the fast
path, not the only one.

- **Skip to main content** is the first thing in the tab order.
- **Focus rings** are a themed token, present on every focusable control.
- Menus, dialogs, and pickers close on <kbd>Escape</kbd> and return focus where
  it came from.
- Dialogs are real dialogs. `window.confirm`, `window.prompt`, and
  `window.alert` appear nowhere in the application.

[Keyboard shortcuts](/shortcuts) lists what each page adds.

## Typefaces

Five typefaces, chosen in [Settings → Appearance](/interface/settings#appearance):

- **OpenDyslexic** is available and is deliberately **not** the default. It serves
  a specific need, and a reader who has not asked for it should not have it chosen
  for them.
- **Public Sans** is the proportional option, for readers who find monospace
  interfaces harder going.
- **Text weight** runs from Light to Bold, because a screen read from two metres
  and a phone at arm's length are different problems.
- **The console has its own typeface and weight**, so a readable interface and a
  dense terminal are not in conflict.

Each option in the picker renders in its own typeface, so the choice is made by
looking rather than by name.

## Text and language

**Every string is translated** — including accessible names, titles,
placeholders, validation messages, and notifications. There is no literal
user-facing text anywhere in a component, which is why a new language is a
translation file rather than a code change.

English and Norwegian Bokmål ship today. A test fails the build if any locale is
missing a key or carries an empty message, so a partially translated release is
not possible.

Time and date formats are separate from language, so you can read the interface
in one language and the clock in the format you actually use.

## Layout

**Every page is verified at desktop width and at 390 px.** Neither the page nor a
toolbar is allowed to acquire horizontal scrolling. Wide content — tables,
charts, code — scrolls inside its own container.

**Text is not selectable by default**, and chrome does not answer a right-click,
because dragging across an interface should not select it. Surfaces whose text you
have a reason to copy — console output, update logs, file contents — opt in
explicitly.

## Screen wake lock

**Settings → Display** can hold the screen awake for a shop-floor display.

Two limits are stated on the page rather than left to be discovered: it holds
only while the tab is in front, and it needs a secure context, so it is
unavailable over a plain LAN address.

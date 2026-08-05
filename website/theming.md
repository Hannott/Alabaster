# Theming

A theme pack remaps every colour role in Alabaster. Components consume roles
rather than colours, so a pack changes the whole interface without touching a
single component.

## Choosing a theme

**Settings → Appearance.**

- **Mode** — Light, Dark, or System.
- **Theme pack** — the colour mapping itself.

The two are independent. Every pack supplies complete light and dark modes, so
switching mode never changes your pack and switching pack never changes your
mode.

The sun and moon control in the header does the same thing from any page. Both
preferences are kept in your browser.

## The bundled pack

**Alabaster** — the only one that ships today. High-contrast blue and sky blue. Its accent and
focus roles reuse the same blue the interface borders with, so a focused control
reads as part of the same system rather than as a highlight bolted on.

## Typefaces are not part of a pack

Typeface, text weight, and the separate console typeface are their own settings.
A font is not a colour mapping, and putting it in a pack would mean choosing a
colour scheme to get a typeface.

Five are available, including OpenDyslexic. See
[Settings → Appearance](/interface/settings#appearance).

## The constraints behind a pack

Three rules make packs interchangeable rather than merely different, and all
three are enforced by tests.

**Only Okabe-Ito chromatic colours.** Every chromatic value comes from the
[Okabe-Ito colour-blind-safe palette](https://jfly.uni-koeln.de/color/). Neutral
variation is black and white with opacity, and nothing else. A pack can combine
them with `color-mix()` and transparency, which keeps the constraint while
leaving room to design.

**Semantic names describe purpose, not hue.** `--status-danger` may be
vermillion, but no component ever asks for vermillion. It asks for danger. That
is what lets a pack change what danger looks like without a component knowing.

**WCAG AA contrast, checked by compositing.** Control colours are derived from
contrast requirements rather than chosen by eye. A test composites every button
variant over every surface it can sit on — at rest, hovered, and pressed — and
fails the build below 4.5:1 for normal text or 3:1 for boundaries.

Colour is also never the only thing carrying status. Whatever a colour says is
also said in text or a distinct shape, so a pack cannot make a state
unreadable — and neither can colour blindness or a badly calibrated workshop
monitor.

## What a pack covers

Not just backgrounds and text. Every pack defines the full token contract:

| Group                   | What it colours                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| Canvas and surfaces     | Page, cards, raised and soft surfaces.                               |
| Text                    | Primary, muted, and text over strong surfaces.                       |
| Structure               | Borders and the focus ring.                                          |
| Actions                 | Primary action, its text, and the accent.                            |
| Control interaction     | The hover and press veils.                                           |
| Availability and safety | Offline, available, recovering, danger, and caution.                 |
| G-code viewer           | Its surface, grid, shadow, nozzle, extrusion, seams, and axes.       |
| G-code feature colours  | Perimeters, infill, bridges, support, skirt, and the feed-rate ramp. |
| Bed mesh height map     | Five height bands plus the level plane.                              |

Every token is declared in both modes, even where the value is identical, so a
pack can never inherit an accidental colour from another one.

Chart data series and brand artwork are the documented exception: their hues are
values rather than roles, so they do not change per pack.

## Writing your own pack

A pack is one CSS file and one registry line.

1. Copy `src/themes/packs/alabaster.css` to `packs/<your-id>.css`.
2. Replace `alabaster` in both selectors with a short lowercase id. Keep one
   selector for `data-theme='light'` and one for `data-theme='dark'`, and do not
   add an unscoped `:root` fallback.
3. Assign every token in both modes, using only variables from `palette.css` —
   optionally combined with `color-mix()` and transparency.
4. Set `color-scheme: light` and `color-scheme: dark` in the matching selectors,
   so native controls follow the mode.
5. Import the file at the end of `index.css`.
6. Add `{ id: '<your-id>', labelKey: 'theme.packs.<your-id>' }` to `themePacks`
   in `registry.ts`.
7. Add the pack's label to every locale under `theme.packs`.

Then:

```bash
npm run check
```

The theme contract, the palette guard, locale alignment, type checking, and the
production build all have to pass. Once they do, the pack appears in the picker
on its own — no component changes anywhere.

The full authoring guide, with the complete token table, lives in
[`src/themes/README.md`](https://github.com/Hannott/Alabaster/blob/main/src/themes/README.md).

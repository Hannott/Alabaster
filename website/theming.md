# Theming

A theme pack remaps every colour role in Alabaster. Components read roles, not
colours, so a pack changes the whole interface without touching a single
component.

## Choosing a theme

Set the theme in Settings → Appearance.

- **Mode**: Light, Dark, or System.
- **Theme pack**: the colour mapping.

The two settings are independent. Every pack includes both a light mode and a
dark mode. Switching mode does not change your pack, and switching pack does
not change your mode.

Both preferences are kept in your browser.

## The bundled pack

Alabaster is the bundled theme pack. It uses high-contrast blue and sky blue.
Its accent and focus colours reuse the same blue as the interface borders, so
a focused control reads as part of the same system, not as a separate
highlight.

## Typefaces are not part of a pack

Typeface, text weight, and the console typeface are separate settings. A font
is not a colour mapping. Putting it in a pack would force you to choose a
colour scheme to get a specific typeface.

Five typefaces are available, including OpenDyslexic. See
[Settings → Appearance](/interface/settings#appearance) for more information.

## The constraints behind a pack

Three rules keep packs interchangeable, not just different-looking. Tests
enforce all three: the first two for every pack, the third for the bundled
pack only. See [when a pack may break them](#a-pack-that-wants-to-be-something-else).

**Only Okabe-Ito chromatic colours.** Every chromatic value comes from the
[Okabe-Ito colour-blind-safe palette](https://jfly.uni-koeln.de/color/).
Neutral variation uses only black and white with opacity. A pack can combine
these with `color-mix()` and transparency without breaking the constraint.

**Semantic names describe purpose, not hue.** `--status-danger` may be
vermillion, but no component asks for vermillion. It asks for danger. This
lets a pack change what danger looks like without changing any component.

**WCAG AA contrast, checked by compositing.** Control colours come from
contrast requirements, not visual judgment. A test composites every button
variant over every surface it can appear on, at rest, hovered, and pressed.
The build fails below 4.5:1 for normal text or 3:1 for boundaries. This test
runs against the bundled `alabaster` pack, which is the baseline every other
interface rule is written against.

Colour is never the only signal for status. Every colour-coded state also
appears in text or a distinct shape. This keeps a state readable regardless of
the pack, colour blindness, or a badly calibrated monitor.

## What a pack covers

A pack covers more than backgrounds and text. Every pack defines the full
token contract:

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

Every token is declared in both modes, even when the value is the same, so a
pack never inherits an accidental colour from another pack.

Chart data series and brand artwork are the exception. Their hues are values,
not roles, so they do not change per pack.

## Writing your own pack

A pack is one CSS file and one registry line.

1. Copy `src/themes/packs/alabaster.css` to `packs/<your-id>.css`.
2. Replace `alabaster` in both selectors with a short lowercase id. Keep one
   selector for `data-theme='light'` and one for `data-theme='dark'`. Do not
   add an unscoped `:root` fallback.
3. Assign every token in both modes, using only variables from
   `palette.css`. You can combine them with `color-mix()` and transparency.
4. Set `color-scheme: light` and `color-scheme: dark` in the matching
   selectors, so native controls follow the mode.
5. Import the file at the end of `index.css`.
6. Add `{ id: '<your-id>', labelKey: 'theme.packs.<your-id>' }` to
   `themePacks` in `registry.ts`.
7. Add the pack's label to every locale under `theme.packs`.

Then:

```bash
npm run check
```

The theme contract, the palette guard, locale alignment, type checking, and
the production build all have to pass. Once they do, the pack appears in the
picker automatically. No component changes are needed.

See [`src/themes/README.md`](https://github.com/Hannott/Alabaster/blob/main/src/themes/README.md)
for the full authoring guide and the complete token table.

## A pack that wants to be something else

Everything above describes a pack that remaps colour. A pack that reproduces
someone else's visual identity, such as a printer firmware's or a person's
own, usually needs more than colour changes. Requiring it to follow the
bundled pack's rules would prevent that identity from being reproduced.

A non-bundled pack is exempt from the rest of the design system: the contrast
floors, the button emphasis scale, the corner-radius and spacing scales, the
motion budget, and the dialog shapes. It can use ordinary CSS rules, not only
custom properties, to change any of these for itself.

The exemption is scoped:

- **It applies only inside that pack's own `[data-theme-pack='<id>']` scope.**
  A pack cannot write a rule that reaches outside itself, edits shared CSS, or
  affects another pack.
- **Every pack still assigns every token in both modes** and still uses
  `palette.css` variables instead of raw colour values. These two rules keep
  a pack switchable, and the build checks both for every pack.
- **The bundled `alabaster` pack is not exempt from anything.** It stays the
  fully conformant baseline, and the contrast test measures against it.

This trade-off is deliberate. A pack that accepts the contrast floors gets
them guaranteed. A pack that reproduces an identity that does not meet them
can say so, instead of approximating it.

# Creating an Alabaster theme pack

Theme packs remap Alabaster's semantic color roles for both light and dark
modes. Components only consume those roles, so a complete pack changes the
whole interface without editing Vue components or Tailwind classes.

The token flow is palette primitive → semantic theme role → component usage.
Palette primitives describe allowed colors, semantic roles describe purpose,
and components consume only the purpose. The data-series and brand aliases in
`tailwind.css` (`--color-data-*`, `--color-brand-*`) are the documented
exception for charts, syntax visualization, and brand artwork, whose hues are
values rather than roles and deliberately do not change per theme pack. The
only palette primitive shared CSS may reach directly is `--ito-black`, for
neutral shadows, backdrops, and masks; a guard test enforces this. Page composition,
component density, and the selectable typeface are defined separately in
[`docs/design/interface-standards.md`](../../docs/design/interface-standards.md) —
a font is not a theme pack and does not belong in one, the same way spacing
and animation do not; see that document's Typography section and
`src/fonts/` for where it actually lives.

All theme-related source lives in this directory:

- `palette.css` contains the permitted Okabe-Ito primitives and black/white
  neutrals. Do not add raw colors elsewhere.
- `tailwind.css` exposes semantic roles as Tailwind utilities.
- `packs/` contains the installed theme packs.
- `registry.ts` lists packs that appear in Settings.
- `contract.ts` is the required semantic-token contract used by tests.
- `index.css` imports every installed pack.

## Add a pack

1. Copy `packs/alabaster.css` to `packs/<your-id>.css`.
2. Replace `alabaster` in both selectors with a short lowercase ID. Keep one
   selector for `data-theme='light'` and one for `data-theme='dark'`. Do not add
   the unscoped `:root` fallback to a custom pack.
3. Assign every token in both modes. Use only variables from `palette.css`,
   optionally combined with `color-mix()` and transparency. This preserves the
   Okabe-Ito accessibility constraint.
4. Import the file at the end of `index.css`.
5. Add `{ id: '<your-id>', labelKey: 'theme.packs.<your-id>' }` to
   `themePacks` in `registry.ts`.
6. Add the pack label to every locale under `theme.packs`.
7. Run `npm run check`. The theme contract, palette guard, locale alignment,
   type checking, and production build must all pass.

After registration, the pack is selectable under Settings → Theme pack. The
Mode radio group there (System/Light/Dark) changes mode without changing the
selected pack, and both preferences persist in local storage.

## Bundled packs

- `Alabaster` is the default high-contrast blue and sky-blue mapping. Its
  accent and focus roles reuse the same blue used for borders throughout the
  interface, such as the focused search border in File Explorer. It is also
  the **canonical pack** referred to throughout this document and every design
  document it links to: the one pack every other rule in the codebase remains
  written against, and the only pack the automated contrast tests run against
  (see "Custom packs may break every other rule" below).
- `Terminal` is a non-canonical pack exercising the exemption below: a CRT
  phosphor screen (near-black surfaces, phosphor green text and actions, amber
  focus ring and caution) in dark mode, a dot-matrix printout (parchment
  surfaces, dark ink green) in light mode. Every value is a raw literal chosen
  for period-correct hue, not a palette primitive or a contrast-derived one.
  It also reaches past color: `AppButton` turns square, monospaced, uppercase,
  and gains a phosphor-bloom glow; `AppSlider`'s track becomes a stepped meter
  with a block-cursor thumb in place of the round one; and both it and
  `AppField` lose their rounded corners and gain uppercase labels. In dark mode
  the console transcript (`.gcode-console`, shared by the Console page, the
  dashboard card, and the Calibration bench) becomes an actual CRT screen —
  curved corners, an inset vignette, a bezel ring, and a phosphor glow on its
  own text — a treatment light mode's dot-matrix printout does not share,
  since a printout has no bezel to wear. All of it lives in rules scoped to
  `[data-theme-pack='terminal']` in `packs/terminal.css`, which the exemption's
  own scoping rule permits — none of it touches `main.css`, `app-field.css`,
  `app-slider.css`, or the components themselves. The pack also adds one rule
  outside the token contract entirely, a static scanline overlay (`::after` on
  `:root[data-theme-pack='terminal']`).
- `Blueprint` is a non-canonical pack reproducing a technical drawing sheet: a
  cyanotype blueprint (white/cyan ink on deep navy paper) in dark mode, a
  whiteprint drafting vellum (navy ink on cool paper) in light mode. Unlike
  Terminal, both modes get the pack's full component treatment rather than one
  mode being a plain fallback — a drafting sheet is what every surface is in
  either polarity. `AppButton` turns square and monospaced, and the solid
  `primary`/`critical` variants gain an inset ink-impression ring, like a
  rubber stamp's own edge; `AppField` and `AppSlider`'s entry box lose their
  rounded corners and gain a faint graph-paper grid behind the value.
  `AppSlider`'s track becomes a ruler — graduated ticks along the unfilled
  length, a solid inked line where filled — and its thumb a downward caliper
  arrow, tinted at rest rather than only on interaction, since a caliper mark
  is a permanent reference and not a hover affordance. The console transcript
  (`.gcode-console`) becomes a full technical drawing sheet in both modes: a
  coarser graph-paper grid, a ruled margin frame inset from the edge, and
  corner registration marks — the alignment ticks a real drafting sheet prints
  in its corners so a set of sheets registers to the same point. All of it
  lives in rules scoped to `[data-theme-pack='blueprint']` in
  `packs/blueprint.css`; the console rule doubles the `data-theme` attribute
  alongside `data-theme-pack` to outrank `.console-main .gcode-console` and
  `.console-module__body .gcode-console`'s `background: none` regardless of
  CSS import order, the same technique Terminal's own console override uses.
  The bed mesh height map and G-code viewer axes also borrow real drafting and
  CAD vocabulary rather than inventing pack-specific hues: the mesh reads as a
  topographic contour map (blue low ground, tan mid, amber/red peaks), and the
  viewer's X/Y/Z axes follow the red/green/blue convention CAD viewports have
  used since the trade had a word for it.

A pack that is removed by product decision is dropped from `themePacks`
entirely; `registry.ts`'s `isThemePackId` migrates anyone who still has it
selected back to `alabaster` without asking.

## Custom packs may break every other rule

Every rule outside this section — the Okabe-Ito primitive constraint and the
WCAG contrast floors above, and every rule in
[`interface-standards.md`](../../docs/design/interface-standards.md),
[`button-system.md`](../../docs/design/button-system.md),
[`dialog-system.md`](../../docs/design/dialog-system.md), and
[`ADR 0004`](../../docs/architecture/0004-motion-and-continuity.md) — is
written against the **canonical `alabaster` pack** and against shared
component code. Any other pack is exempt from all of it, entirely and on
purpose.

**The failure this prevents:** an earlier non-canonical pack's own entry above
used to end "while retaining Alabaster's layout and interaction language" — a
compromise forced on it because every rule elsewhere in the codebase was
phrased as universal, not "universal for the one pack the product ships by
default." Faithfully reproducing a printer firmware's or a person's own visual
identity often means
a different corner-radius scale, a different motion budget, a button that
does not follow the six-variant emphasis taxonomy, or a contrast ratio the
identity being reproduced does not itself meet — and a reviewer holding a new
pack to `button-system.md`'s state model or `ADR 0004`'s motion rules
regardless of what the pack is for is exactly how that compromise gets forced
again. A pack that only remaps color tokens never needed this exemption; a
pack that wants to _be_ something else does.

This is a per-pack, self-contained exemption, not a hole in the design system
generally:

- It applies only inside that pack's own `[data-theme-pack='<id>']` scope. A
  custom pack may add ordinary CSS rules under that selector — not just custom
  property declarations — to override spacing, radius, typography, animation,
  or button and dialog shape for itself; it may never write a rule that reaches
  outside its own scope or edits shared CSS, `main.css`, or another pack.
- It does not touch shared component code. `AGENTS.md`'s "never use a color
  literal in a component" and "never add literal user-facing text in a
  component" still apply everywhere, including inside a custom pack's own
  components if it ships any — the exemption is for the pack's own CSS values,
  not for how components consume them.
- It does not touch the `alabaster` pack itself, which stays the fully
  conformant baseline every measurement in `button-system.md` is taken
  against.
- It does not touch the technical token contract below. Every pack, canonical
  or not, still declares every token in "Required semantic tokens" for light
  and dark, because that is the mechanism that lets a component swap packs at
  all — not a design rule about how the interface should look. `themes.spec.ts`
  enforces this for every pack unconditionally.
- The automated contrast guard (`controlContrast.spec.ts`) runs only against
  `defaultThemePackId` for exactly this reason: a custom pack that ships
  inaccessible contrast on purpose is exercising this exemption, not failing a
  test that forgot to exclude it.

Add a pack under this exemption the same way as any other — steps 1-7 above —
but skip the "Authoring rules" and "Canvas surfaces" sections below where they
conflict with the identity the pack is reproducing; those sections describe
the canonical pack's own constraints, not a requirement this pack inherits.

## Required semantic tokens

Every pack defines all tokens below once in its light selector and once in its
dark selector. A value may be identical between modes, but the declaration must
still be present so a pack never inherits an accidental value from another
pack.

| Group                   | Tokens                                                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas and surfaces     | `--surface-canvas`, `--surface-canvas-glass`, `--surface-raised`, `--surface-soft`, `--surface-strong`, `--surface-on-strong-soft`                                                                                                                                                        |
| G-code viewer           | `--viewer-surface`, `--viewer-grid`, `--viewer-shadow`, `--viewer-nozzle`, `--viewer-extrusion`, `--viewer-progress`, `--viewer-seam`, `--viewer-axis-x`, `--viewer-axis-y`, `--viewer-axis-z`, `--viewer-accent`                                                                         |
| G-code feature colours  | `--viewer-feature-perimeter-outer`, `--viewer-feature-perimeter-inner`, `--viewer-feature-infill`, `--viewer-feature-infill-solid`, `--viewer-feature-bridge`, `--viewer-feature-support`, `--viewer-feature-skirt`, `--viewer-feature-other`, `--viewer-feed-slow`, `--viewer-feed-fast` |
| Bed mesh height map     | `--mesh-low-deep`, `--mesh-low`, `--mesh-middle`, `--mesh-high`, `--mesh-high-deep`, `--mesh-plane`                                                                                                                                                                                       |
| Text                    | `--text-primary`, `--text-muted`, `--text-on-strong`, `--text-on-strong-muted`, `--text-on-strong-faint`                                                                                                                                                                                  |
| Structure               | `--border-subtle`, `--focus-ring`                                                                                                                                                                                                                                                         |
| Actions                 | `--action-primary`, `--action-on-primary`, `--accent-primary`                                                                                                                                                                                                                             |
| Control interaction     | `--interaction-veil`, `--interaction-veil-strong`                                                                                                                                                                                                                                         |
| Availability and safety | `--status-offline`, `--status-available`, `--status-recovering`, `--status-danger`, `--status-danger-soft`, `--status-danger-text`, `--status-danger-strong`, `--status-danger-border`, `--status-on-danger`, `--status-caution-text`, `--status-caution-border`, `--status-caution-veil` |

Also set `color-scheme: light` and `color-scheme: dark` in the corresponding
selectors so native controls match the pack mode.

## Authoring rules

- Semantic names describe purpose, not hue. For example, `--status-danger`
  may use vermillion, but components refer only to the danger role.
- Text, controls, focus rings, and borders must meet WCAG AA contrast. Check
  normal text at 4.5:1 and large text or UI boundaries at 3:1.
- The control tokens are contrast-derived, not chosen by eye.
  `src/themes/__tests__/controlContrast.spec.ts` composites every button variant
  over `--surface-raised`, `--surface-soft`, and `--surface-canvas` at rest, on
  hover, and pressed, and fails the pack below 4.5:1. Expect to tune
  `--status-danger-text` and the two veils to your own surfaces: a pack whose
  dark surfaces are warm mid-greys rather than near-black needs a much lighter
  danger label than Alabaster's. See
  [`docs/design/button-system.md`](../../docs/design/button-system.md) for what
  each token does.
- **A boundary keeps its own budget, separate from its label's.**
  `--status-danger-border` and `--status-caution-border` draw outlines and rings,
  which are non-text and owe 3:1 rather than 4.5:1, so they carry far more of
  their hue than the matching `-text` token can. Do not collapse a border onto a
  label value to save a token: `--status-danger-text` is capped by the text
  floor, and by the time vermillion is legible at a label's size the floor has
  flattened nearly all of it out — which is exactly how a danger control ends up
  reading no more urgent than a neutral one.

  How much of the hue a border can keep is set by that mode's own
  `--surface-soft`, so **each pack states its measured share in a comment beside
  the declaration** rather than copying another pack's figure. Alabaster's
  light and dark both carry 90% vermillion, but a pack whose dark surfaces are
  a warm mid-grey may need to settle for 60%, because against a warm mid-grey
  nothing at or above 70% clears 3:1 at all.

- **`--status-caution-veil` composites over a fill, not over a surface.** Like
  `--interaction-veil`, it lands on whatever the control is already filled with,
  so it has to keep a label readable over `--action-primary` as well as over a
  soft neutral — the blue case is the binding one, because an orange veil moves
  that background toward its own label rather than away from it.
- Status must remain understandable without color. Theme work must not remove
  the accompanying text or icon shape.
- Test every route in both modes, at narrow and desktop widths, with keyboard
  focus visible and with reduced motion enabled.
- Do not put spacing, typography, layout, or animation overrides in the
  `alabaster` pack. Those are shared interface behavior, not theme semantics —
  for that one pack. A non-canonical pack may do exactly this; see "Custom
  packs may break every other rule" above.

## Canvas surfaces

A canvas cannot read a custom property: `fillStyle` takes a color, and
`var(--mesh-low)` is not one. Anything painted rather than styled therefore has
to resolve its tokens into concrete values first, which creates a second way for
a pack to be applied and a second way for it to go stale.

Two rules keep that from drifting away from the packs:

- **Resolve once, not per frame.** Set the variable on a throwaway element and
  read back the computed color. Doing it inside the paint routine would re-run
  the whole resolution on every frame of an animation, and would tie the paint
  code to a document it should not need.
- **Re-resolve when the pack changes, and only then.** Switching pack or mode
  rewrites the variables but repaints nothing, so a canvas keeps the old
  palette until something else happens to redraw it. Observe `data-theme` and
  `data-theme-pack` on the document element and repaint. `GcodeViewerView` and
  the Bed mesh module both do exactly this; copy whichever is closer.

A painted surface still owes the same accessibility as a styled one. It carries
`role="img"` and a localized `aria-label` describing what it shows, and no
reading depends on the paint alone — the Bed mesh card labels both ends of its
gradient with their values and states the lowest, highest and range in text.

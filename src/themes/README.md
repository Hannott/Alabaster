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
sun/moon control changes mode without changing the selected pack, and both
preferences persist in local storage.

## Bundled packs

- `Alabaster` is the default high-contrast blue and sky-blue mapping. Its
  accent and focus roles reuse the same blue used for borders throughout the
  interface, such as the focused search border in File Explorer. It is also
  the **canonical pack** referred to throughout this document and every design
  document it links to: the one pack every other rule in the codebase remains
  written against, and the only pack the automated contrast tests run against
  (see "Custom packs may break every other rule" below).
- No other pack ships today. `Kalico` shipped for a time and was removed by
  product decision; `registry.ts`'s `isThemePackId` migrates anyone who still
  has it selected back to `alabaster` without asking. Historical measurements
  against Kalico's surfaces remain in [`button-system.md`](../../docs/design/button-system.md)
  as worked examples of the contrast method, not as a claim that the pack is
  installed.

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

**The failure this prevents:** Kalico's own entry above used to end "while
retaining Alabaster's layout and interaction language" — a compromise forced
on it because every rule elsewhere in the codebase was phrased as universal,
not "universal for the one pack the product ships by default." Faithfully
reproducing a printer firmware's or a person's own visual identity often means
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
  `--status-danger-text` and the two veils to your own surfaces: Kalico needs a
  much lighter danger label than Alabaster because its dark surfaces are warm
  mid-greys rather than near-black. See
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
  the declaration** rather than copying another pack's figure. The spread is
  wide: three of the four light/dark combinations carry 90% vermillion, and
  Kalico's dark carries 60%, because against a warm mid-grey nothing at or above
  70% clears 3:1 at all.

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

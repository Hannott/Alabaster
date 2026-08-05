/**
 * The interface typeface, selectable from Settings → Appearance. Every entry
 * is self-hosted (no CDN fetch, per ADR 0001) and lazy-loaded: `load()` only
 * runs for the font actually chosen, so switching between five families never
 * costs the other four. Only the Latin subset and the weights the interface
 * actually uses are imported — the full static weight range each family
 * ships, since the "Text weight" setting (`src/fonts/weights.css`) can land
 * on any of them depending on what a reader picks and how far
 * `--font-weight-increased`/`-decreased` sit from it. See
 * `docs/design/interface-standards.md`'s Typography section for which weight
 * each family stops short of, and what happens there.
 *
 * Every entry loads only its own sans family. `--font-mono` is never a
 * separate face to load — `fonts.css` points it at `var(--font-sans)`, so
 * whichever family this loads is what numeric readouts, macro buttons, and
 * the console render in too.
 */
export type FontId = 'sourceCodePro' | 'robotoMono' | 'overpassMono' | 'publicSans' | 'openDyslexic'

interface FontDefinition {
  id: FontId
  labelKey: string
  /** Marks OpenDyslexic apart in the picker; never the only cue, matching every other status in Alabaster. */
  dyslexiaFriendly?: boolean
  load: () => Promise<unknown>
}

export const fonts: readonly FontDefinition[] = [
  {
    id: 'sourceCodePro',
    labelKey: 'theme.fonts.sourceCodePro',
    load: () =>
      Promise.all([
        import('@fontsource/source-code-pro/latin-200.css'),
        import('@fontsource/source-code-pro/latin-300.css'),
        import('@fontsource/source-code-pro/latin-400.css'),
        import('@fontsource/source-code-pro/latin-400-italic.css'),
        import('@fontsource/source-code-pro/latin-500.css'),
        import('@fontsource/source-code-pro/latin-600.css'),
        import('@fontsource/source-code-pro/latin-700.css'),
        import('@fontsource/source-code-pro/latin-800.css'),
        import('@fontsource/source-code-pro/latin-900.css'),
      ]),
  },
  {
    id: 'robotoMono',
    labelKey: 'theme.fonts.robotoMono',
    load: () =>
      Promise.all([
        import('@fontsource/roboto-mono/latin-100.css'),
        import('@fontsource/roboto-mono/latin-200.css'),
        import('@fontsource/roboto-mono/latin-300.css'),
        import('@fontsource/roboto-mono/latin-400.css'),
        import('@fontsource/roboto-mono/latin-400-italic.css'),
        import('@fontsource/roboto-mono/latin-500.css'),
        import('@fontsource/roboto-mono/latin-600.css'),
        import('@fontsource/roboto-mono/latin-700.css'),
      ]),
  },
  {
    id: 'overpassMono',
    labelKey: 'theme.fonts.overpassMono',
    load: () =>
      Promise.all([
        import('@fontsource/overpass-mono/latin-300.css'),
        import('@fontsource/overpass-mono/latin-400.css'),
        import('@fontsource/overpass-mono/latin-500.css'),
        import('@fontsource/overpass-mono/latin-600.css'),
        import('@fontsource/overpass-mono/latin-700.css'),
      ]),
  },
  {
    id: 'publicSans',
    labelKey: 'theme.fonts.publicSans',
    load: () =>
      Promise.all([
        import('@fontsource/public-sans/latin-100.css'),
        import('@fontsource/public-sans/latin-200.css'),
        import('@fontsource/public-sans/latin-300.css'),
        import('@fontsource/public-sans/latin-400.css'),
        import('@fontsource/public-sans/latin-400-italic.css'),
        import('@fontsource/public-sans/latin-500.css'),
        import('@fontsource/public-sans/latin-600.css'),
        import('@fontsource/public-sans/latin-700.css'),
        import('@fontsource/public-sans/latin-800.css'),
        import('@fontsource/public-sans/latin-900.css'),
      ]),
  },
  {
    id: 'openDyslexic',
    labelKey: 'theme.fonts.openDyslexic',
    dyslexiaFriendly: true,
    load: () =>
      Promise.all([
        import('@fontsource/opendyslexic/latin-400.css'),
        import('@fontsource/opendyslexic/latin-400-italic.css'),
        import('@fontsource/opendyslexic/latin-700.css'),
      ]),
  },
] as const

/**
 * Source Code Pro: the widest weight coverage of any monospace entry here
 * (200–900), which is what the default has to have. The "Text weight" setting
 * reaches `900` at its Bold level, and a default family topping out at `700` —
 * as Roboto Mono and Overpass Mono both do — would render that level's
 * headings identically to its body text, so the setting would appear not to
 * work at the one end a reader is most likely to try. Roboto Mono and Overpass
 * Mono remain as narrower monospace alternatives; Public Sans is the offered
 * proportional face, with the widest range of any entry (100–900);
 * OpenDyslexic stays an explicit opt-in rather than the default: it serves a
 * narrower, specific need, and a reader who has not asked for it should not
 * have it chosen for them.
 */
export const defaultFontId: FontId = 'sourceCodePro'

export function isFontId(value: string): value is FontId {
  return fonts.some((font) => font.id === value)
}

/**
 * Shared by `useFont` and `useConsoleFont`: the interface typeface and the
 * console's own (independent) typeface can both name the same font, and this
 * is what keeps that from fetching it twice. A font already loaded for one
 * purpose is already loaded for the other.
 */
const loadedFontIds = new Set<FontId>()

export function ensureFontLoaded(id: FontId): void {
  if (loadedFontIds.has(id)) return
  loadedFontIds.add(id)
  void fonts.find((font) => font.id === id)?.load()
}

/**
 * Called once a font picker is about to open, not on mount: previewing every
 * option in its own face needs all five loaded, which is otherwise exactly
 * what lazy-loading exists to avoid shipping to a reader who never opens the
 * picker at all.
 */
export function ensureAllFontsLoaded(): void {
  fonts.forEach((font) => ensureFontLoaded(font.id))
}

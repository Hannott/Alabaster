import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')
// `components.css` carries the shared component rules main.css used to hold
// directly; main.css itself is now just the `@layer`/`@import` header (ADR
// 0009), so a check written against "the stylesheet" reads both as one.
const styles =
  readFileSync(join(sourceRoot, 'styles', 'main.css'), 'utf8') +
  '\n' +
  readFileSync(join(sourceRoot, 'styles', 'components.css'), 'utf8')
const app = readFileSync(join(sourceRoot, 'App.vue'), 'utf8')
const temperatures = readFileSync(
  join(sourceRoot, 'components', 'dashboard', 'modules', 'TemperaturesModule.vue'),
  'utf8',
)
const availabilityRegion = readFileSync(
  join(sourceRoot, 'components', 'AvailabilityRegion.vue'),
  'utf8',
)
const appIcon = readFileSync(join(sourceRoot, 'components', 'AppIcon.vue'), 'utf8')

describe('motion system', () => {
  it('defines shared timing and easing tokens', () => {
    expect(styles).toContain('--motion-duration-instant: 60ms')
    expect(styles).toContain('--motion-duration-fast: 120ms')
    expect(styles).toContain('--motion-duration-standard: 180ms')
    expect(styles).toContain('--motion-duration-slow: 240ms')
    expect(styles).toContain('--motion-ease-standard:')
    expect(styles).not.toMatch(/transition:\s*all\b/)
    expect(styles).not.toMatch(/transition:[^;]*grid-template-columns/)
  })

  it('crossfades routes and dims retained pending content without local status panels', () => {
    expect(app).toContain('<Transition name="route-view" appear>')
    expect(styles).toContain('.route-stage > *')
    expect(styles).toContain('.availability-region--recovering > .availability-region__content')
    expect(availabilityRegion).not.toContain('role="status"')
    expect(styles).not.toContain('.availability-notice')
  })

  it('provides a reduced-motion fallback', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain("[data-pending='true']")
    expect(styles).toContain('animation: none !important')
  })

  it('keeps telemetry digits and units stable without fading live updates', () => {
    // A reading that reflows as its own digits change is a value the eye has to
    // re-find every second. This used to be a `min-width` on the temperature
    // cell itself; the table now fixes the numeric track for every row at once,
    // which holds the same guarantee for a reading that has none of its own.
    // The track must stay `rem` rather than `fr` — a track that flexes with its
    // content is a column that moves — and tabular figures keep the digits from
    // shuffling inside it. One track rather than two since the reading and its
    // target became one field, and the reading moved into that field's notch,
    // which is why the notch needs the tabular rule as much as a value cell.
    const [, tracks] =
      styles.match(/\.temperature-table\s*{\s*grid-template-columns:([^;]*);/s) ?? []
    expect(tracks).toBeDefined()
    expect((tracks ?? '').trim().split(/\s+/).at(-1)).toMatch(/rem$/)
    expect(styles).toMatch(/\.module-table__value\s*{[^}]*font-variant-numeric:\s*tabular-nums/s)
    expect(styles).toMatch(
      /\.temperature-cell--value \.app-field__label\s*{[^}]*font-variant-numeric:\s*tabular-nums/s,
    )
    expect(temperatures).toContain('minimumFractionDigits: 1')
    expect(temperatures).toContain('maximumFractionDigits: 1')
    expect(temperatures).toContain('integerFormatter.value.format(')
    expect(temperatures).toContain("t('dashboard.temperatureUnit')")
    expect(styles).not.toContain('.telemetry-value-enter-active')
    expect(styles).not.toContain('.telemetry-detail-enter-active')
    expect(temperatures).not.toContain('<Transition')
  })

  it('holds the console transcript still at its edges rather than bouncing it', () => {
    // `contain` and `none` agree about scroll chaining, which is all the
    // transcript wants; they differ in that `contain` keeps the local
    // overscroll affordance, and on Windows that is an elastic bounce — the log
    // sliding a pixel or two under a wheel tick it has already decided to
    // ignore. A surface that is pinned should look pinned.
    const transcript = styles.match(/\.gcode-console\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(transcript).toContain('overscroll-behavior: none;')
    expect(transcript).not.toContain('overscroll-behavior: contain;')
    // The escape hatch still hands the gesture to the page once the reader asks.
    expect(styles).toMatch(/\.gcode-console--edge-released\s*\{[^}]*overscroll-behavior:\s*auto;/s)
  })

  it('resizes the machine explorer without fading file navigation', () => {
    expect(styles).toContain(
      'flex-basis var(--motion-duration-standard) var(--motion-ease-emphasized)',
    )
    expect(styles).not.toContain(".machine-workspace[data-pending='true']")
    expect(styles).not.toContain(".machine-code-editor[data-pending='true']")
  })

  it('keeps the compact machine explorer geometry stable while it resizes', () => {
    expect(styles).toMatch(
      /\.machine-file-row\s*{[^}]*height:\s*3rem;[^}]*min-height:\s*3rem;[^}]*max-height:\s*3rem;/s,
    )
    expect(styles).toMatch(
      /\.machine-workspace--maximized \.machine-file-row\s*{[^}]*height:\s*3rem;[^}]*min-height:\s*3rem;[^}]*max-height:\s*3rem;/s,
    )
    expect(styles).toContain('overflow-anchor: none')
    expect(styles).toContain('scrollbar-gutter: stable')
    for (const selector of [
      '.machine-workspace--maximized .machine-toolbar',
      '.machine-workspace--maximized .machine-search',
      '.machine-workspace--maximized .machine-file-columns',
    ]) {
      const declarations = styles.match(
        new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`),
      )?.[1]
      expect(declarations ?? '').not.toMatch(/display:\s*none/)
    }
  })

  it('turns a settings cog off the state the DOM already holds', () => {
    // ADR 0004's cog section. A modifier class a component sets when it opens
    // something is a copy of "these settings are showing", and the copy is
    // what survives the pane: Escape, an outside press, and a route change all
    // close one without running the code that would clear the class. Reading
    // the control's own state instead cannot go stale, so there is deliberately
    // no `.cog-icon--*` modifier to set.
    expect(appIcon).toContain(
      "name === 'settings' ? 'cog-icon' : name === 'spinner' ? 'spinner-icon' : undefined",
    )
    expect(styles).toMatch(
      /\[aria-pressed='true'\] > \.cog-icon,\s+\[aria-expanded='true'\] > \.cog-icon,\s+\.router-link-active > \.cog-icon \{/,
    )
    expect(styles).not.toContain('.cog-icon--')

    // The glyph is line-md's cog flattened to its final frame, and the loop is
    // CSS rather than line-md's own per-tooth `animateTransform`: SMIL is
    // unreachable from a selector and sits outside the blanket reduced-motion
    // rule, so a cog looped that way would keep turning for someone who asked
    // for no motion.
    expect(styles).toContain('@keyframes cog-turn')
    const cogGlyph = appIcon.slice(
      appIcon.indexOf('<g v-else-if="name === \'settings\'"'),
      appIcon.indexOf('<g v-else-if="name === \'more\'"'),
    )
    expect(cogGlyph).not.toContain('<animate')
  })

  it('keeps sidebar controls anchored while labels fade', () => {
    expect(app).toMatch(/class="[^"]*\bsidebar-toggle\b[^"]*\bself-start\b/)
    expect(app).not.toMatch(/class="[^"]*\bsidebar-toggle\b[^"]*\bself-end\b/)
    expect(styles).toContain(
      ".app-shell[data-sidebar-collapsed='true'] .sidebar-brand,\n" +
        ".app-shell[data-sidebar-collapsed='true'] .sidebar-nav-link {\n  gap: 0;\n}",
    )
    expect(styles).not.toContain(
      ".app-shell[data-sidebar-collapsed='true'] .sidebar-toggle {\n  align-self:",
    )
    expect(styles).toContain('max-inline-size: 0;\n  opacity: 0;')
  })
})

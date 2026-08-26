import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { navigationDestinations } from '@/navigation/destinations'

const projectRoot = process.cwd()
const sourceRoot = join(projectRoot, 'src')

/*
 * The design documents are internal working material and absent from a public
 * checkout. Where a document is present, its registration assertions run so
 * code and document cannot drift; a checkout without the documents still runs
 * every code-side assertion.
 */
function designDoc(name: string): string | null {
  const path = join(projectRoot, 'docs', 'design', name)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}
const styles = source('styles/main.css')

function source(path: string): string {
  return readFileSync(join(sourceRoot, path), 'utf8')
}

describe('page layout contract', () => {
  it('keeps every routed view on one of the two documented page shells', () => {
    const standardViews = [
      'views/DashboardView.vue',
      'views/CalibrationView.vue',
      'views/HistoryView.vue',
      'views/TimelapseView.vue',
      'views/MachineView.vue',
      'views/SettingsView.vue',
    ]
    const workspaceViews = [
      'views/ConfigurationView.vue',
      'views/ConsoleView.vue',
      'views/GcodeViewerView.vue',
      'views/PrintFilesView.vue',
    ]

    for (const view of standardViews) expect(source(view)).toContain('class="standard-page')
    for (const view of workspaceViews) expect(source(view)).toContain('class="workspace-page')
  })

  it('names every routed view through the shared PageHeading component, never a hand-rolled header', () => {
    // Every routed view — both page shells alike — names itself through the one
    // `PageHeading` component rather than its own copy of the header/h1/action
    // markup. That used to be hand-rolled per view: the row's height came out
    // different on a route with an action button than on one without (nothing
    // reserved the space), Settings nested its copy inside the width-capped
    // `page-column` measure so its title sat narrower and off-centre from every
    // other route's, and workspace-page routes used to rely on a visually
    // hidden h1 with a workspace pane's own title standing in for the visible
    // name — which stopped working once more than one workspace route reused
    // its pane title for the route name. One component now owns the row height,
    // the action's button recipe, and the contract below, so a future route
    // gets all three by construction instead of by copying the last view that
    // got it right.
    const routedViews = [
      'views/DashboardView.vue',
      'views/CalibrationView.vue',
      'views/HistoryView.vue',
      'views/TimelapseView.vue',
      'views/MachineView.vue',
      'views/SettingsView.vue',
      'views/ConfigurationView.vue',
      'views/ConsoleView.vue',
      'views/GcodeViewerView.vue',
      'views/PrintFilesView.vue',
    ]

    for (const view of routedViews) {
      const template = source(view)
      expect(template, `${view} needs the shared PageHeading component`).toMatch(
        /<PageHeading[\s/]/,
      )
      expect(template, `${view} must not hand-roll a second page-heading header`).not.toContain(
        'class="page-heading"',
      )
    }

    // Settings' body is deliberately narrower than the canvas — a Moonraker
    // address field a monitor-width long is unreadable — but that measure
    // belongs to `.settings-page` alone. Nesting `PageHeading` inside it, the
    // way this route once nested its own hand-rolled header, would narrow and
    // centre the title along with the body instead of leaving it full-width
    // like every other route's.
    const settings = source('views/SettingsView.vue')
    expect(
      settings,
      'Settings must not nest PageHeading inside the width-capped settings-page column',
    ).not.toMatch(/class="[^"]*settings-page[^"]*"[\s\S]*?<PageHeading/)

    const heading = source('components/PageHeading.vue')
    expect(heading, 'PageHeading needs one visible route title').toContain(
      '<h1 class="page-heading__title">',
    )
    expect(heading, 'PageHeading must not grow an eyebrow').not.toContain('page-heading__eyebrow')
    expect(heading, 'PageHeading must not grow a standing description').not.toContain(
      'page-heading__description',
    )
    // The one recipe every page-heading action uses — see button-system.md's
    // migration map — so an action never arrives at a size or variant that
    // does not fit the row's fixed height.
    expect(heading, 'PageHeading action must use the canonical button recipe').toContain(
      'class="button button--on-soft"',
    )
  })

  it('reserves one fixed row height for the page heading, whether or not a route has an action', () => {
    // Unset, the row was only ever as tall as its tallest child: text-only on a
    // route with no action, taller on a route with one — so the same heading
    // read a different height from page to page. Fixed to the plain `md`
    // button height, the row holds still and an action button (always `md`
    // itself) never has to stretch it to fit.
    expect(styles).toMatch(/\.page-heading\s*\{[^}]*min-height:\s*2\.25rem/s)
  })

  it('contains wide data inside a standard page instead of widening the page', () => {
    expect(styles).toMatch(/\.page-column\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(styles).toMatch(
      /\.history-totals,\s*\.history-stats,\s*\.history-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    )
    expect(styles).toMatch(/\.history-jobs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(styles).toMatch(/\.history-outcome-table\s*\{[^}]*overflow-x:\s*auto/s)
  })

  /*
   * `1fr` alone still floors a grid track at its widest item's content-based
   * minimum size, which for a `white-space: nowrap`-truncated string is that
   * string's full unwrapped width — so a `.page-card` reporting a long
   * unbreakable one (a camera's `http://192.168.1.125:4747/video`) widened the
   * single column every Settings card stacks in, and every card on the page,
   * not only the wide one, inherited the oversized column. Caught only by a
   * real printer's own camera data; the reference fixtures never had a string
   * long enough to trigger it. `minmax(0, 1fr)` is required everywhere a track
   * holds a `.page-card`, including inside the narrow-width media query, which
   * had silently dropped the floor `.settings-body`'s own desktop declaration
   * two lines above it already carried.
   */
  it('floors every settings grid track so a long camera URL cannot widen it', () => {
    expect(styles).toMatch(/\.settings-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)

    // Two `.settings-body` declarations exist on purpose — the desktop rule
    // and the narrow-width override that replaces its whole track list — and
    // each has to carry its own floor rather than inherit the other's.
    const settingsBodyBlocks = [...styles.matchAll(/\.settings-body\s*\{([^}]*)\}/gs)].map(
      (match) => match[1],
    )
    expect(settingsBodyBlocks).toHaveLength(2)
    expect(settingsBodyBlocks[0]).toMatch(/grid-template-columns:\s*12rem minmax\(0, 1fr\)/)
    expect(settingsBodyBlocks[1]).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('keeps Configuration and Machine as separate primary routes', () => {
    const router = source('router/index.ts')
    const destinationNames = navigationDestinations.map((entry) => entry.name)

    expect(router).toContain("path: '/configuration'")
    expect(router).toContain("name: 'configuration'")
    expect(router).toContain("path: '/machine'")
    expect(destinationNames).toContain('configuration')
    expect(destinationNames).toContain('machine')
  })

  it('never gates folder or file navigation behind an unsaved-editor dialog', () => {
    const explorer = source('views/ConfigurationView.vue')
    const standard = designDoc('interface-standards.md')
    const navigateTo = explorer.slice(
      explorer.indexOf('async function navigateTo'),
      explorer.indexOf('async function createFile'),
    )

    // The dirty-gate dialog this once guarded (requestEditorAction) is gone
    // entirely: every buffered file's edits survive navigation on their own,
    // so there is nothing left to gate.
    expect(explorer).not.toContain('requestEditorAction')
    expect(navigateTo).toContain('await machineFiles.navigate(path)')
    expect(explorer).toMatch(
      /if \(entry\.kind === 'directory'\) \{\s*search\.value = ''\s*await machineFiles\.enterDirectory\(entry\.name\)\s*return\s*\}\s*await openWithWarningGate/s,
    )
    if (standard) {
      expect(standard).toContain(
        'Switching files, changing folders, closing the editor, or leaving the\n  route never discards an edit and never prompts.',
      )
    }
  })

  it('uses Alabaster resource tiles instead of circular gauge meters', () => {
    const machine = source('views/MachineView.vue')
    const english = source('locales/en.json')

    expect(machine).toContain('name="processor"')
    expect(machine).toContain('name="ram"')
    expect(styles).toContain('.machine-meter__track')
    expect(styles).not.toContain('conic-gradient(')
    expect(english).toContain('"memory": "RAM"')
  })

  it('keeps host telemetry precise and meter percentages visually stable', () => {
    const machine = source('views/MachineView.vue')
    const standard = designDoc('interface-standards.md')

    expect(machine).toContain('minimumFractionDigits: 1')
    expect(machine).toContain('maximumFractionDigits: 1')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(styles).toContain('text-align: end')
    expect(styles).toContain('justify-content: center')
    if (standard) {
      expect(standard).toContain('Always retain the trailing zero')
    }
  })

  it('sizes the update console from the popout, not from a growing line count', () => {
    const standard = designDoc('interface-standards.md')
    // Comments are stripped so a negative assertion cannot be satisfied — or
    // defeated — by prose explaining the very declaration it forbids.
    const console = styles
      .slice(styles.indexOf('.update-console {'), styles.indexOf('.update-console__empty'))
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')

    // The dialog's own fixed viewport sizes the transcript — a plain scrollback
    // that scrolls, the way a real terminal window does, rather than a box that
    // resizes itself from a line count as output arrives.
    expect(console).toContain('flex: 1 1 auto;')
    expect(console).toContain('min-height: 0;')
    expect(console).not.toMatch(/--output-lines/)
    expect(console).not.toMatch(/(?:min|max)-block-size:/)

    expect(console).toMatch(/overflow-y:\s*auto/)
    expect(console).toContain('font-family: var(--font-mono);')

    // No per-line entrance animation remains: a real terminal's scrollback
    // appears instantly, it does not rise into place.
    expect(styles).not.toContain('machine-output-line-in')
    expect(styles).not.toContain('output-line-enter-active')
    if (standard) {
      expect(standard).toContain('plain scroll-to-the-bottom window')
    }
  })

  it('keeps update rows on the same inline edge as the rest of the panel', () => {
    // 0.5rem of list padding + the row button's own 1px border + its inline
    // padding is the 1rem every other panel row uses. The border has to be
    // subtracted, not ignored: these rows are controls and the others are not, so
    // ignoring it leaves the source names 1px inside every neighbouring row.
    expect(styles).toMatch(/\.machine-update-list\s*\{[^}]*padding:\s*0\.5rem/s)
    expect(styles).toMatch(
      /\.machine-update-row\s*\{[^}]*padding:\s*0\.75rem calc\(0\.5rem - 1px\)/s,
    )
    expect(styles).toMatch(/\.machine-panel-heading\s*\{[^}]*padding:\s*0\.8rem 1rem/s)
    expect(styles).toMatch(/\.machine-module-list > h3\s*\{[^}]*padding:\s*0\.8rem 1rem/s)
  })

  /*
   * The root switcher is a band in the pane's stack, not a line inside the
   * header. `.machine-pane-header` is a fixed 4rem, so a third row added to its
   * identity block is clipped rather than given room — which is how the pane
   * heading lost its top edge — and a control in the title block reads as
   * floating over the copy rather than belonging to the pane.
   */
  /*
   * Every band in a file workspace's stack holds its height whether or not it has
   * anything to say. Two ways that was broken: the recent-files band was removed
   * entirely when there was nothing to offer — so switching roots, which drops the
   * recents belonging to the root being left, moved every row below it — and the
   * Print files trail had no height at all, so it resized as the path got longer.
   *
   * `overflow-x: auto` is the second half of the trail bug: it makes a box
   * scrollable on both axes, so a trail one pixel taller than its content box grew
   * a vertical scrollbar. Each trail pins `overflow-y` to hidden.
   */
  it('reserves the height of every band in a file workspace stack', () => {
    for (const band of [
      '.machine-breadcrumbs',
      '.machine-recent-files',
      '.print-files-breadcrumbs',
    ]) {
      const rule = styles.slice(styles.indexOf(`${band} {`))
      const body = rule.slice(0, rule.indexOf('}'))
      expect(body, `${band} must reserve its height`).toMatch(/min-height:\s*[\d.]+rem/)
      expect(body, `${band} must not flex-shrink`).toMatch(/flex:\s*0 0 [\d.]+rem/)
    }

    for (const trail of ['.machine-breadcrumbs', '.print-files-breadcrumbs']) {
      const rule = styles.slice(styles.indexOf(`${trail} {`))
      const body = rule.slice(0, rule.indexOf('}'))
      expect(body, `${trail} must not scroll vertically`).toContain('overflow-y: hidden')
    }

    // The band renders unconditionally; only its contents switch.
    const view = source('views/ConfigurationView.vue')
    const band = view.slice(view.indexOf('class="machine-recent-files"') - 200)
    expect(band.slice(0, 200)).not.toContain('v-if="lastEditedFile"')
    expect(view).toContain('class="machine-recent-files__empty"')
    // Shown only once the listing has arrived: recents derive from it, so a root
    // switch clears them first and the empty state would blink a false answer.
    expect(view).toContain('v-else-if="!machineFiles.isDirectoryLoading"')
  })

  it('gives the root switcher its own band rather than a row inside the header', () => {
    const view = source('views/ConfigurationView.vue')

    // The band sits between the header and the breadcrumbs, and closes with a
    // border like every other band in this stack.
    expect(view).toMatch(/<\/header>\s*<div class="machine-root-tabs"/s)
    expect(styles).toMatch(/\.machine-root-tabs\s*\{[^}]*border-block-end:\s*1px solid/s)
    expect(styles).toMatch(/\.machine-pane-header\s*\{[^}]*height:\s*4rem/s)

    // Underline tabs from the documented `tab-select` pattern, and the accent has
    // to sit over the strip's border rather than inside the tab's own box — inside
    // it leaves that border showing underneath and reads as two lines.
    expect(view).toContain('class="tab-select"')
    expect(view).not.toContain('machine-root-switch')
    expect(styles).toMatch(
      /\.tab-select\[aria-pressed='true'\]::after\s*\{[^}]*inset-block-end:\s*-1px/s,
    )
  })

  it('uses one unconditional viewport canvas for every route transition', () => {
    const app = source('App.vue')

    expect(app).toContain('class="app-main w-full"')
    expect(app).not.toContain('max-w-[100rem]')
    expect(styles).toMatch(/\.app-main\s*{[^}]*height:\s*calc\(100dvh - 5rem\)/s)
    expect(styles).toMatch(/\.app-main\s*{[^}]*overflow:\s*hidden/s)
    /*
     * The stage takes whatever the column leaves rather than a literal 100% of
     * it: the fault notice shares this box, and a stage claiming the full height
     * beside it would push the shell past the viewport and hand the document a
     * scrollbar. Still one unconditional canvas — the geometry is a flex rule
     * that resolves the same way with the notice absent, not a conditional one.
     */
    expect(styles).toMatch(/\.app-main\s*{[^}]*display:\s*flex/s)
    expect(styles).toMatch(/\.app-main\s*{[^}]*flex-direction:\s*column/s)
    expect(styles).toMatch(/\.route-stage\s*{[^}]*flex:\s*1 1 auto/s)
    expect(styles).toMatch(/\.printer-fault\s*{[^}]*flex:\s*0 0 auto/s)
    expect(styles).not.toContain('.app-main:has(')
    expect(styles).not.toContain('layout-settle-')
    expect(styles).not.toMatch(/\.route-view-(?:enter-from|leave-to)\s*{[^}]*(?:scale|translate)/s)
  })

  it('keeps the desktop sidebar pinned to viewport height', () => {
    expect(styles).toMatch(/\.desktop-sidebar\s*{[^}]*position:\s*sticky/s)
    expect(styles).toMatch(/\.desktop-sidebar\s*{[^}]*block-size:\s*100dvh/s)
    expect(styles).toMatch(/\.desktop-sidebar\s*{[^}]*max-block-size:\s*100dvh/s)
  })

  /*
   * Every box that measures itself against the viewport measures against the one
   * on screen. A single `vh` left in this chain is a phone-only defect no desktop
   * check can see: `vh` is the large viewport — the height the page would have
   * once the browser's URL bar has retracted — so with the bar showing the
   * document outgrows the screen and the whole application acquires a page scroll
   * the length of that bar, with nothing under it but background. On desktop the
   * two units are the same number, and this assertion is the only thing that
   * notices.
   */
  it('measures the shell against the viewport actually on screen', () => {
    expect(styles).toMatch(/\nbody\s*{[^}]*min-height:\s*100dvh/s)
    expect(styles).not.toMatch(/\nbody\s*{[^}]*min-height:\s*100vh/s)
    expect(styles).toMatch(/\.app-shell\s*{[^}]*min-block-size:\s*100dvh/s)
    expect(styles).toMatch(/\.app-content\s*{[^}]*min-height:\s*100dvh/s)
  })

  /*
   * The console page's panel states its flex basis rather than taking `auto`.
   * With `auto` the panel sizes from its own content, and its content is the
   * transcript — so a long transcript grew the panel far past the workspace
   * (9006px inside 564px at 390px wide), left `.gcode-console--fill` nothing to
   * overflow, and put the prompt thousands of pixels below the fold. This page
   * exists to give the transcript its own scroll; a content-sized basis takes
   * that away and hands the scrolling to the workspace instead.
   */
  it('keeps the console transcript scrolling inside its own panel at phone widths', () => {
    expect(styles).toMatch(/\.console-main\s*{[^}]*min-height:\s*22rem;[^}]*flex:\s*1 1 22rem/s)
    expect(styles).not.toMatch(/\.console-main\s*{[^}]*flex:\s*1 0 auto/s)
    expect(styles).toMatch(/\.gcode-console--fill\s*{[^}]*min-height:\s*0/s)
  })

  /*
   * Whichever element owns the scrolling is the one allowed to state a height.
   * The settings surface has two arrangements and they answer that differently:
   * side by side the pane is the bound and `__content` scrolls inside it, while
   * stacked hands the scrolling to `__body` and `__content` goes back to visible
   * overflow. A `max-height` left standing over visible overflow bounds only what
   * is *painted* — the border, the radius and the fill stop at the cap while the
   * content carries on past it — so the last rows of a long pane stood on the
   * backdrop below the card that was supposed to contain them. The two
   * declarations are one decision, and this pins them to each other.
   */
  it('lets the stacked settings pane grow with the content it no longer scrolls', () => {
    expect(styles).toMatch(
      /\.settings-surface--stacked \.settings-surface__content\s*{[^}]*overflow-y:\s*visible/s,
    )
    expect(styles).toMatch(
      /\.settings-surface--stacked \.settings-surface__pane\s*{[^}]*max-height:\s*none/s,
    )

    // Side by side the pane *is* the scroll region, so there it keeps its bound.
    expect(styles).toMatch(/\.settings-surface__pane\s*{[^}]*max-height:\s*calc\(100dvh - 2rem\)/s)
    expect(styles).toMatch(/\.settings-surface__content\s*{[^}]*overflow-y:\s*auto/s)
  })
})

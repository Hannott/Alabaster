import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

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
const styles = readFileSync(join(sourceRoot, 'styles', 'main.css'), 'utf8')
const appFieldStyles = readFileSync(join(sourceRoot, 'styles', 'app-field.css'), 'utf8')
const appSliderStyles = readFileSync(join(sourceRoot, 'styles', 'app-slider.css'), 'utf8')
const appOutputRowStyles = readFileSync(join(sourceRoot, 'styles', 'app-output-row.css'), 'utf8')
const allStyles = `${styles}\n${appFieldStyles}\n${appSliderStyles}\n${appOutputRowStyles}`
const iconSource = readFileSync(join(sourceRoot, 'components', 'AppIcon.vue'), 'utf8')

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

/**
 * Every `<AppButton>` in a template, as its attribute text and its slot body.
 *
 * A regex alone cannot do this: `<AppButton ... />` beside `<AppButton>...
 * </AppButton>` makes any lazy `</AppButton>` match run across the sibling and
 * report the next element's children as this one's. Self-closing tags are
 * recognised explicitly instead, and quoted attribute values are skipped so a
 * `>` inside one does not end the tag early.
 */
function appButtons(source: string): { attrs: string; body: string }[] {
  const found: { attrs: string; body: string }[] = []
  for (const match of source.matchAll(/<AppButton\b/g)) {
    let index = match.index + match[0].length
    let quote: string | null = null
    while (index < source.length) {
      const char = source[index]
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      index += 1
    }
    const attrs = source.slice(match.index + match[0].length, index)
    if (attrs.trimEnd().endsWith('/')) {
      found.push({ attrs, body: '' })
      continue
    }
    const close = source.indexOf('</AppButton>', index)
    found.push({ attrs, body: close === -1 ? '' : source.slice(index + 1, close) })
  }
  return found
}

describe('interaction and iconography contract', () => {
  it('uses pointer and not-allowed cursors for actionable and disabled controls', () => {
    expect(styles).toMatch(/button:not\(:disabled\)[\s\S]*cursor:\s*pointer/)
    expect(styles).toMatch(/button:disabled[\s\S]*cursor:\s*not-allowed/)
    expect(styles).toContain("[aria-disabled='true'] button")

    // The caret over a listbox option and over the words beside a checkbox were
    // the two the per-element list missed, because neither is a `<button>`. A
    // clickable thing that shows a text caret is telling the user it is text.
    const [pointerRule] = styles.match(/:where\([\s\S]*?\)\s*\{\s*cursor:\s*pointer;/) ?? []
    expect(pointerRule).toContain("[role='option']")
    expect(pointerRule).toContain("[role='menuitem']")
    expect(pointerRule).toContain("label:has(> input[type='checkbox']:not(:disabled))")
    expect(pointerRule).toContain("label:has(> input[type='radio']:not(:disabled))")
  })

  /*
   * Selection, the context menu, and the checkbox row: three rules that were
   * each opt-in per component and therefore each incomplete. What every one of
   * these asserts is that the decision is made once, in a place a component
   * added tomorrow inherits without knowing it exists.
   */
  it('makes text selection opt-in rather than opting out per element type', () => {
    // The default belongs on the document. `button, select, a, [role=button]`
    // is what this replaced, and it left labels, list rows, menu options, and
    // every reported value selectable — the double-click smear the rule exists
    // to prevent.
    expect(styles).toMatch(/\bbody\s*\{[^}]*user-select:\s*none/)
    expect(styles).not.toMatch(/\[role='button'\]\s*\{[^}]*user-select:\s*none/)

    // Content surfaces opt back in, and form fields never have to.
    const [optIn] = styles.match(/\.selectable,[^{]*\{[^}]*user-select:\s*text[^}]*\}/) ?? []
    expect(optIn).toContain('input')
    expect(optIn).toContain('textarea')
  })

  it('paints no selection highlight outside the surfaces that opt in', () => {
    // `user-select: none` is only half of it, and not the half the user sees.
    // Blink keeps unselectable content out of the copied text but still paints
    // the selection background over it whenever a larger selection covers the
    // range — which Select All and any drag anchored in a selectable region
    // both produce. That is why a card full of buttons smeared blue despite
    // those buttons already being unselectable, and why asserting `user-select`
    // alone let the defect survive a green test run.
    expect(styles).toMatch(/\n::selection \{[^}]*background-color: transparent/)

    // The highlight comes back exactly where selection does, so the two rules
    // cannot drift into disagreeing about which surfaces are content.
    const [highlight] = styles.match(/\.selectable::selection,[\s\S]*?\}/) ?? []
    for (const surface of ['.selectable *::selection', 'input::selection', 'textarea::selection']) {
      expect(highlight, `${surface} must keep a visible highlight`).toContain(surface)
    }
    // Derived from the accent, so retinting a pack retints the selection too.
    expect(highlight).toMatch(/color-mix\(in srgb, var\(--action-primary\) 30%, transparent\)/)
  })

  it('marks the surfaces whose text is content the user copies out', () => {
    // The two transcripts, the configuration editor's rendered text, reported
    // errors, and the host facts. Each is named in interface-standards.md; a
    // surface losing its class silently stops being copyable, which is only
    // discovered by someone trying to paste a failure into a bug report.
    const selectable: Record<string, string> = {
      'components/console/ConsoleTranscript.vue': 'gcode-console selectable',
      'components/UpdateCommitList.vue': 'update-recovery-commits selectable',
      'components/MachineUpdateConsoleDialog.vue': 'update-console selectable',
      'views/ConfigurationView.vue': 'machine-code-highlight selectable',
    }

    for (const [path, marker] of Object.entries(selectable)) {
      expect(readFileSync(join(sourceRoot, path), 'utf8'), path).toContain(marker)
    }
  })

  it('suppresses the browser context menu everywhere except where it has entries', () => {
    const guard = readFileSync(join(sourceRoot, 'composables', 'useContextMenuGuard.ts'), 'utf8')

    // One document-level listener, not a per-component @contextmenu.prevent.
    expect(guard).toContain("document.addEventListener('contextmenu'")
    expect(guard).toContain("document.removeEventListener('contextmenu'")
    expect(readFileSync(join(sourceRoot, 'App.vue'), 'utf8')).toContain('useContextMenuGuard()')

    // A link's Open in new tab is the one native entry this application relies
    // on, and a text field's menu is the only way to paste on some platforms.
    for (const surface of ['input', 'textarea', 'a[href]', '.selectable']) {
      expect(guard).toContain(surface)
    }
  })

  it('builds every checkbox and radio row from the one shared row', () => {
    // The row shrinks to its content because a <label> forwards a click from
    // anywhere in its box: a full-width one toggles from empty space past the
    // end of its own text. --block is the exception, for a row whose own fill
    // or border shows the user how far the control reaches.
    expect(styles).toMatch(/\.check-row\s*\{[^}]*width:\s*fit-content/)
    expect(styles).toMatch(/\.check-row--block\s*\{[^}]*width:\s*auto/)
    // A settings row whose control is a number field is an `AppField`, and it
    // shrinks for the same reason: a full-width `<label>` hands focus to the
    // field from empty space past the end of its own words.
    expect(appFieldStyles).toMatch(
      /\.app-field--label-front,\s*\.app-field--label-back\s*\{[^}]*width:\s*fit-content/,
    )

    // Consecutive rows separate themselves, and a set behind one descriptive
    // word puts the same gap between the word and the first box as between the
    // choices — the uneven pair is what made the previous set read as cramped.
    expect(styles).toMatch(/\.check-row:not\(:first-child\)\s*\{[^}]*margin-block-start:\s*0\.2rem/)
    expect(styles).toMatch(/\.check-set\s*\{[^}]*column-gap:\s*0\.5rem/)
    expect(styles).toMatch(/\.check-set\s*\{[^}]*margin-inline-start:\s*0\.4rem/)

    // The divider between choices is anchored to the item that follows it, not
    // placed in the gap between two items — `:not(:first-child)` cannot tell
    // which item starts a wrapped line, so a divider built as a rule between
    // items would orphan itself the moment the set wraps. Anchoring it to the
    // item's own box means it wraps with that item instead of being wrong.
    expect(styles).toMatch(
      /\.check-set > \.check-row:not\(:first-child\)::before\s*\{[^}]*background:\s*var\(--border-subtle\)/,
    )
    expect(styles).not.toMatch(/\.check-row \+ \.check-row[^{]*\{[^}]*border/)

    // The box is drawn in the product's own language rather than the platform's:
    // the field's border, corner, and fill, and the button system's primary pair
    // when checked. A platform-drawn box is the one control that does not match
    // the field or the select beside it.
    const [box] =
      styles.match(/input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{[^}]*\}/) ?? []
    expect(box).toContain('appearance: none')
    expect(box).toContain('border: 1px solid var(--border-subtle)')
    expect(box).toMatch(/border-radius:\s*0\.3rem/)
    expect(styles).toMatch(
      /input\[type='checkbox'\]:checked,\s*input\[type='radio'\]:checked\s*\{[^}]*background-color:\s*var\(--action-primary\)/,
    )
    // Size and tint come from that one element rule, not from the four families
    // that each set their own and disagreed about all three values.
    for (const family of ['.header-menu__toggle', '.gcode-check-row', '.gcode-settings-option']) {
      expect(styles, `${family} must not size its own checkbox`).not.toMatch(
        new RegExp(`\\${family} input[^{]*\\{[^}]*(?:width|accent-color):`),
      )
    }

    // No label anywhere may carry a checkbox or radio without the shared row.
    // Template comments are stripped first: a comment explaining this very rule
    // is liable to mention `<label>` in backticks, and an unstripped scan reads
    // that prose as a real opening tag with no class, matches the nearest real
    // `</label>` many lines later, and reports a false offender.
    const offenders: string[] = []
    for (const path of filesBelow(sourceRoot).filter((file) => file.endsWith('.vue'))) {
      const source = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      const name = relative(sourceRoot, path).replace(/\\/g, '/')
      for (const [, open, body] of source.matchAll(/(<label\b[^>]*>)([\s\S]*?)<\/label>/g)) {
        if (!/type="(?:checkbox|radio)"/.test(body)) continue
        if (!/class="[^"]*\bcheck-row\b/.test(open)) offenders.push(`${name}: ${open.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('gives every caption one treatment and keeps it attached to what it explains', () => {
    // Five families said this five times and disagreed about two of the three
    // values, so two captions on one screen were visibly not the same kind of
    // text. The proximity ratio is the load-bearing part: a caption sitting
    // evenly between two controls makes the reader work out which one it is for.
    const [caption] = styles.match(/\.hint,\s*\.module-settings__hint,[\s\S]*?\}/) ?? []
    expect(caption).toContain('.surface-section__hint')
    expect(caption).toContain('.gcode-view-description')
    expect(caption).toMatch(/font-size:\s*var\(--text-hint-size\)/)

    expect(styles).toMatch(/\.hint,[\s\S]*?\{\s*margin-block:\s*0\.1rem 0\.6rem/)
    for (const family of ['.surface-section__hint', '.gcode-view-description']) {
      expect(styles, `${family} must not restate the shared caption`).not.toMatch(
        new RegExp(`\\${family}\\s*\\{[^}]*(?:font-size|color|margin):`),
      )
    }

    // The indent is derived from the control above, not applied to every hint:
    // a note under a slider or a field has no box to clear.
    expect(styles).toMatch(
      /\.check-row \+ \.module-settings__hint\s*\{[^}]*margin-inline-start:\s*1\.7rem/,
    )
  })

  /*
   * A closed `<dialog>` is hidden by exactly one UA rule,
   * `dialog:not([open]) { display: none }`, and any author `display` declaration
   * on the element overrides it — so a dialog rule that sets `display` without
   * qualifying on `[open]` draws its whole body inline in the page, on every
   * route, with nothing open. The manual probe prompt shipped that way for an
   * afternoon: a stray Accept and Abort at the top of the shell with a real
   * printer behind them. `.update-console-dialog[open]` had already found the
   * same edge, which is what makes this a rule rather than an incident.
   *
   * Matches only the dialog element's own class — a name ending in `-dialog`,
   * not one of its `__part` or `--modifier` descendants, which are ordinary
   * elements and may set `display` freely.
   */
  it('qualifies a dialog element with [open] before giving it a display', () => {
    const offenders: string[] = []
    // Comments name other dialogs' classes constantly, and a rule's own header
    // comment sits between the previous `}` and this selector.
    const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '')

    for (const [, selectorList, body] of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/display\s*:/.test(body)) continue
      for (const selector of selectorList.split(',')) {
        // Only the subject counts — `.some-dialog > header` styles the header,
        // and every `__part` of a dialog is an ordinary element.
        const subject =
          selector
            .trim()
            .split(/\s*[>+~]\s*|\s+/)
            .at(-1) ?? ''
        if (!/\.[\w-]*-dialog(?![\w-])/.test(subject)) continue
        // `::backdrop` is a pseudo-element of the dialog, not the dialog's box.
        if (subject.includes('::')) continue
        if (!subject.includes('[open]')) offenders.push(selector.trim())
      }
    }

    expect(offenders).toEqual([])
  })

  /*
   * A dialog measures its block axis against the viewport actually on screen:
   * `dvh`, never `vh`. The two are the same number on a desktop and differ on a
   * phone, where `vh` is the *large* viewport — the height the page would have
   * once the browser's URL bar had retracted. A dialog sized in `vh` is therefore
   * taller than the screen for as long as that bar is showing, and one that tiles
   * its header and body edge to edge drops the bottom of the body off the end of
   * the display with nothing to scroll to reach it. No desktop check can catch
   * that, which is the whole reason it is asserted here.
   *
   * `.image-lightbox` is the one dialog element not named `-dialog`, so it is
   * matched by name; the inline axis is deliberately not covered, because no
   * browser chrome retracts sideways and `vw` is still the right unit there.
   */
  it('sizes every dialog against the viewport actually on screen', () => {
    const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '')
    const offenders: string[] = []

    for (const [, selectorList, body] of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const isDialog = selectorList.split(',').some((selector) => {
        const subject =
          selector
            .trim()
            .split(/\s*[>+~]\s*|\s+/)
            .at(-1) ?? ''
        return /\.[\w-]*-dialog(?![\w-])/.test(subject) || /\.image-lightbox(?![\w-])/.test(subject)
      })
      if (!isDialog) continue

      for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
        if (!/^(?:min-|max-)?(?:height|block-size)$/.test(property)) continue
        // `100dvh` must not read as a `vh`: the digit-then-`vh` shape only
        // matches the bare unit, since `dvh` puts a `d` between the two.
        if (/\d\s*vh(?![\w-])/.test(value)) {
          offenders.push(`${selectorList.trim()} { ${property}: ${value.trim()} }`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps a help text to what the control cannot say itself', () => {
    // A hint says a consequence, a boundary, or a dependency outside Alabaster.
    // It never narrates the interface back to the reader and never sells the
    // feature — see "What a help text is allowed to say" in settings-surface.md.
    // Length is the mechanical proxy: the copy that broke this rule ran to 313
    // characters of commentary, and everything true in it fitted in 58.
    const english = JSON.parse(readFileSync(join(sourceRoot, 'locales', 'en.json'), 'utf8'))
    const offenders: string[] = []

    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (!/hint$/i.test(path)) return
        if (node.length > 140) offenders.push(`${path}: ${node.length} characters`)
        return
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          walk(value, path ? `${path}.${key}` : key)
        }
      }
    }

    walk(english, '')
    expect(offenders).toEqual([])
  })

  it('keeps interface SVGs in the shared icon component', () => {
    // Brand artwork and data visualizations are not interface icons, which is
    // why these three are exempt. Temperatures left this list when its chart
    // moved into a component of its own — a module that draws its own plot
    // inline is the shape the exemption was quietly covering for.
    const allowedSvgFiles = new Set([
      'components/AlabasterMark.vue',
      'components/AppIcon.vue',
      'components/dashboard/modules/TemperatureChart.vue',
      // Movement's bed plan draws the build volume, not an icon — and it is a
      // component of its own for the same reason the temperature chart is.
      'components/dashboard/modules/MovementBedPlan.vue',
      // History's trend chart draws stacked bars, not an icon, for the same reason.
      'components/history/HistoryTrendChart.vue',
    ])

    for (const path of filesBelow(sourceRoot).filter((candidate) => candidate.endsWith('.vue'))) {
      const sourcePath = relative(sourceRoot, path).replaceAll('\\', '/')
      if (readFileSync(path, 'utf8').includes('<svg')) expect(allowedSvgFiles).toContain(sourcePath)
    }
  })

  it('uses one shared line-icon construction without raw glyph icons', () => {
    expect(iconSource).toContain('viewBox="0 0 24 24"')
    expect(iconSource).toContain('stroke="currentColor"')
    expect(iconSource).toContain('stroke-width="1.8"')
    expect(iconSource).toContain('stroke-linecap="round"')
    expect(iconSource).toContain('stroke-linejoin="round"')
    expect(iconSource.match(/name === 'download'/g)).toHaveLength(1)
    // `download`/`upload` no longer share a tray path — each now draws its
    // own distinct Griddy Icons glyph. `reset`/`undo` are the current
    // example of the same "shared construction" principle: one glyph, named
    // twice, rather than two copies of an equivalent path.
    expect(iconSource.match(/name === 'reset' \|\| name === 'undo'/g)).toHaveLength(1)

    const rawIconGlyph = /aria-hidden="true">\s*(?:\+|−|↺|»|↑|↓)\s*</
    for (const path of filesBelow(sourceRoot).filter((candidate) => candidate.endsWith('.vue'))) {
      expect(readFileSync(path, 'utf8')).not.toMatch(rawIconGlyph)
    }
  })

  it('builds every control from the one shared button system', () => {
    // Radius comes from the size tier, with no exceptions among the button
    // variants. `critical` used to carry a 999px pill here, reserved for the
    // emergency stop; it now marks a terminal action whose confirmation has
    // been switched off, and takes the ordinary rectangle. Reserving the pill
    // for non-buttons is what lets the emergency stop keep it as a signal, so
    // no button variant may claim one.
    expect(styles).toMatch(/\.button\s*\{[^}]*border-radius:\s*0\.4rem/)
    expect(styles).toMatch(/\.button--sm\s*\{[^}]*border-radius:\s*0\.3rem/)
    expect(styles).toMatch(/\.button--xs\s*\{[^}]*border-radius:\s*0\.25rem/)
    expect(styles).not.toMatch(/\.button--[a-z-]*\s*\{[^}]*border-radius:\s*999px/)

    expect(styles).toMatch(/\.button\s*\{[^}]*min-height:\s*2\.25rem/)
    expect(styles).toMatch(/\.button--sm\s*\{[^}]*min-height:\s*2rem/)
    expect(styles).toMatch(/\.button--xs\s*\{[^}]*min-height:\s*1\.75rem/)

    // One hover mechanism, one press mechanism, one disabled opacity. Each of
    // these replaced four or more competing treatments.
    expect(styles).toContain(
      'background-image: linear-gradient(var(--interaction-veil), var(--interaction-veil));',
    )
    expect(styles).toMatch(
      /\.button:disabled,\s*\.button\[aria-disabled='true'\]\s*\{[^}]*opacity:\s*0\.5/,
    )
  })

  it('recolors a border, insets a ring, or tightens an outline on focus — never a floating ring', () => {
    // Every bordered control already carries a real border in its box model
    // (`button--quiet` only makes that border's colour transparent, it never
    // removes it), so `:focus-visible` just recolors it. No outline, no
    // offset, no width added outside the box.
    const [, borderRecolorSelectors] =
      styles.match(
        /([^{}]*:focus-visible[^{}]*)\{\s*outline:\s*none;\s*border-color:\s*var\(--focus-ring\);\s*\}/,
      ) ?? []
    expect(borderRecolorSelectors, 'the shared border-recolor focus rule is missing').toBeDefined()
    for (const selector of [
      '.button:focus-visible',
      '.field:focus-visible',
      '.field:has(input:focus-visible)',
      '.app-field__box:has(input:focus-visible)',
      '.app-slider__entry:has(input:focus-visible)',
      "input[type='checkbox']:focus-visible",
      "input[type='radio']:focus-visible",
      '.header-status:focus-visible',
      '.app-select__panel:focus-visible',
      '.update-console:focus-visible',
    ]) {
      expect(borderRecolorSelectors, selector).toContain(selector)
    }

    // Filled boxes with no border of their own move the ring inside instead
    // of floating it outside, so it still reads as that box's own edge. Each
    // of these three also shares its `:focus-visible` with a colour-only
    // `:hover` rule, so the match picks the block that actually declares the
    // ring rather than the first (hover-shared) occurrence of the selector.
    for (const selector of [
      '.gcode-console',
      '.gcode-viewer-stage',
      '.machine-recent-files__file',
    ]) {
      const escaped = selector.replace(/[.[\]]/g, '\\$&')
      const body = [
        ...styles.matchAll(new RegExp(`${escaped}:focus-visible\\s*\\{([^}]*)\\}`, 'g')),
      ]
        .map(([, ruleBody]) => ruleBody)
        .find((ruleBody) => ruleBody.includes('box-shadow'))
      expect(body, selector).toContain('outline: none;')
      expect(body, selector).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--focus-ring\);/)
    }

    // Bare text with neither a border nor a fill — `file-select` and
    // `text-action` — is the one exception that keeps an outline, pulled in
    // from a floating 2px gap to 1px so it sits close against the letterforms.
    const [, bareTextSelectors] =
      styles.match(
        /([^{}]*:focus-visible[^{}]*)\{\s*outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*1px;\s*\}/,
      ) ?? []
    expect(bareTextSelectors, 'the tightened bare-text outline rule is missing').toBeDefined()
    expect(bareTextSelectors).toContain('.file-select:focus-visible')
    expect(bareTextSelectors).toContain('.text-action:focus-visible')
    // A tab has no border or fill to draw a ring against either.
    expect(bareTextSelectors).toContain('.tab-select:focus-visible')

    // Nothing outside those three groups may declare its own outline — a
    // fourth, bespoke focus model creeping back in one component at a time is
    // exactly what naming the three groups is meant to prevent.
    for (const [, selectors, body] of allStyles.matchAll(
      /([^{}]*:focus-visible[^{}]*)\{([^}]*outline:[^}]*)\}/g,
    )) {
      const isBareTextGroup = selectors.includes('.file-select:focus-visible')
      expect(body, selectors).toMatch(
        isBareTextGroup
          ? /outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*1px;/
          : /outline:\s*none;/,
      )
    }
  })

  it('builds every field from the one shared field, on the button geometry scale', () => {
    expect(styles).toContain("@import './app-field.css';")

    // A field and the button beside it share the height and radius scale, so
    // neither has to be nudged to line up with the other.
    expect(styles).toMatch(
      /\.field,[\s\S]*?\{[^}]*min-height:\s*2\.25rem[^}]*border-radius:\s*0\.4rem/,
    )
    expect(styles).toMatch(
      /\.field--sm,[\s\S]*?\{[^}]*min-height:\s*2rem[^}]*border-radius:\s*0\.3rem/,
    )
    expect(styles).toMatch(
      /\.field--xs,[\s\S]*?\{[^}]*min-height:\s*1\.75rem[^}]*border-radius:\s*0\.25rem/,
    )
    expect(styles).toMatch(/\.field,[\s\S]*?\.app-field__box\s*\{[^}]*min-height:\s*2\.25rem/)
    expect(styles).toMatch(/\.field--sm,[\s\S]*?\.app-field__box--sm\s*\{[^}]*min-height:\s*2rem/)

    // The complete AppField owns one measured height per size. Every label
    // position uses this same root rule. Equal clearance on both sides keeps
    // the input box geometrically centred; the embedded label merely occupies
    // part of the already-reserved upper half and cannot move that centre line.
    const [, appFieldRule] = appFieldStyles.match(/^\.app-field\s*\{([^}]*)\}/m) ?? []
    expect(appFieldRule, 'the complete AppField geometry rule is missing').toBeDefined()
    expect(appFieldRule).toContain('--app-field-box-block-size: 2.25rem')
    expect(appFieldRule).toMatch(/padding-block:\s*0\.5rem;/)
    expect(appFieldRule).toContain('block-size: calc(var(--app-field-box-block-size) + 1rem)')

    expect(appFieldStyles).toMatch(
      /\.app-field--size-sm\s*\{[^}]*--app-field-box-block-size:\s*2rem/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field--size-xs\s*\{[^}]*--app-field-box-block-size:\s*1\.75rem/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field__box\s*\{[^}]*block-size:\s*var\(--app-field-box-block-size\)/,
    )

    // A long outside label may ellipsize horizontally, but it cannot wrap and
    // make `front` or `back` taller than `embed`. Truncation lives on the
    // inner `.app-field__label-text`, not the label row itself, so an
    // optional `labelIcon` can sit beside it without being clipped too.
    const [, outsideLabelRule] =
      appFieldStyles.match(
        /\.app-field--label-front > \.app-field__label \.app-field__label-text,\s*\.app-field--label-back > \.app-field__label \.app-field__label-text\s*\{([^}]*)\}/,
      ) ?? []
    expect(outsideLabelRule, 'the outside-label height guard is missing').toBeDefined()
    expect(outsideLabelRule).toContain('white-space: nowrap')
    expect(outsideLabelRule).toContain('text-overflow: ellipsis')

    // An embedded label cannot spend the trailing space occupied by reset. The
    // start-aligned notch narrows before the target, and an end-aligned notch
    // moves its anchor before it; the action itself stays above the notch as a
    // final defence against browser text scaling.
    expect(appFieldStyles).toMatch(
      /\.app-field--label-embed \.app-field__box--has-reset \.app-field__label\s*\{[^}]*max-width:\s*calc\(100% - 3\.1rem\)/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field--label-embed[\s\S]*\.app-field__box--has-reset[\s\S]*\.app-field__label--end\s*\{[^}]*inset-inline:\s*auto 2\.6rem/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field__reset\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2/,
    )

    // The approved compact shape stacks the full xs targets rather than
    // shrinking them. The fixed AppField root continues to own row geometry;
    // the transparent 28px targets may reach its block edges without making the
    // input box taller or consuming two controls' worth of inline space.
    const [, stepperRule] = appFieldStyles.match(/\.app-field__steppers\s*\{([^}]*)\}/) ?? []
    expect(stepperRule, 'the paired steppers rule is missing').toBeDefined()
    expect(stepperRule).toMatch(/flex-direction:\s*column/)
    expect(stepperRule).toMatch(/gap:\s*0/)

    const [, stepperButtonRule] = appFieldStyles.match(/\.app-field__stepper\s*\{([^}]*)\}/) ?? []
    expect(stepperButtonRule, 'the stepper button exception is missing').toBeDefined()
    expect(stepperButtonRule).toContain('color: var(--text-muted)')
    expect(stepperButtonRule).toContain('background-color: transparent')
    expect(stepperButtonRule).toContain('background-image: none')

    // Hover paints the arrow only. The full target never gains the shared
    // button veil, and the glyph moves from light grey to the interactive text
    // colour without changing the target's geometry.
    expect(appFieldStyles).toMatch(
      /\.app-field__stepper:hover:not\(:disabled, \[aria-disabled='true'\]\)[\s\S]*?\{[^}]*background-color:\s*transparent;[^}]*background-image:\s*none;/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field__stepper:hover:not\(:disabled, \[aria-disabled='true'\]\)[\s\S]*?\.app-field__stepper-icon,[\s\S]*?\{[^}]*color:\s*var\(--text-primary\);/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field__stepper:focus-visible \.app-field__stepper-icon\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\);/,
    )

    // Reset now shares the steppers' own exception rather than the standard
    // quiet-icon-button veil: it sits in the same trailing group, so the two
    // read as one family of icon-only actions. The template carries no shared
    // button classes on it, and the CSS repeats the transparent-chrome,
    // arrow/glyph-only-highlight pattern instead of composing `.button`.
    const appFieldSource = readFileSync(join(sourceRoot, 'components', 'AppField.vue'), 'utf8')
    expect(appFieldSource).not.toMatch(/class="[^"]*\bbutton\b[^"]*app-field__reset/)
    const [, resetButtonRule] = appFieldStyles.match(/\.app-field__reset\s*\{([^}]*)\}/) ?? []
    expect(resetButtonRule, 'the reset button exception is missing').toBeDefined()
    expect(resetButtonRule).toContain('background-color: transparent')
    expect(appFieldStyles).toMatch(
      /\.app-field__reset:hover:not\(:disabled, \[aria-disabled='true'\]\)[\s\S]*?\.app-field__reset-icon,[\s\S]*?\{[^}]*color:\s*var\(--text-primary\);/,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field__reset:focus-visible \.app-field__reset-icon\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\);/,
    )

    // A field with no steppers reserves the single vertical column's footprint
    // explicitly so its box stays aligned with a steppered peer.
    // The decision lives on AppField rather than on a wrapper inspecting its
    // children, so an all-plain group is not indented for controls it lacks.
    expect(
      appFieldStyles,
      'a plain field must be able to reserve the stepper footprint explicitly',
    ).toMatch(/\.app-field--reserve-steppers\s*\{[^}]*padding-inline-end:\s*2\.1rem/)

    // Multi-field layout is ordinary module layout, not a second AppField
    // primitive. The callers keep long labels, values, reset, and the vertical
    // target column readable by stating one column first and opting into two
    // only from 100rem, with a tighter vertical rhythm than the horizontal gap
    // between the two columns.
    const responsiveFieldGrid = 'grid grid-cols-1 gap-y-1 min-[100rem]:grid-cols-2 gap-x-4'
    const machineModule = readFileSync(
      join(sourceRoot, 'components', 'dashboard', 'modules', 'MachineModule.vue'),
      'utf8',
    )
    const extruderModule = readFileSync(
      join(sourceRoot, 'components', 'dashboard', 'modules', 'ExtruderModule.vue'),
      'utf8',
    )
    expect(machineModule).toContain(responsiveFieldGrid)
    expect(extruderModule.split(responsiveFieldGrid)).toHaveLength(4)
    expect(allStyles).not.toContain('.app-field-grid')

    // Neither does the box get a height of its own per label position: all
    // AppFields take the same tier from the groups above, so an embedded field
    // and a settings row are the same height. A placement that set its own would
    // reintroduce the mismatch one layer further down, where the tier groups
    // still look correct.
    for (const [selector, body] of appFieldStyles.matchAll(
      /([^{}]*app-field__box[^{}]*)\{([^}]*)\}/g,
    )) {
      if (!selector?.includes('app-field--')) continue
      expect(body ?? '', `${selector.trim()} must not set its own field height`).not.toMatch(
        /(?:^|[\s;])(?:min-)?height:/,
      )
    }

    // The ring is the shared one. Two families drew their own accent border and
    // soft shadow instead, which is a second focus model in a product whose
    // standard says there is one; three more had no rule at all.
    const [focusRule] = styles.match(/([^{}]*\.field:focus-visible[^{}]*)\{[^}]*\}/) ?? []
    expect(focusRule).toContain('.button:focus-visible')
    expect(focusRule).toContain('.field:has(input:focus-visible)')
    expect(focusRule).toContain('.app-field__box:has(input:focus-visible)')
    expect(focusRule).toContain('.app-slider__entry:has(input:focus-visible)')
    expect(allStyles).not.toMatch(/:focus(?:-within)?[^{]*\{[^}]*box-shadow:\s*0 0 0 2px/)

    // An embedded label uses the outlined floating-label anatomy: the label
    // cuts one plain notch in the field edge, while the nested input yields its
    // own border to the box that also contains the unit suffix.
    const [, embeddedLabelRule] =
      appFieldStyles.match(/\.app-field--label-embed \.app-field__label\s*\{([^}]*)\}/) ?? []
    expect(embeddedLabelRule).toContain('background: linear-gradient(')
    expect(embeddedLabelRule).toContain('font-size: var(--text-field-label-size)')
    expect(embeddedLabelRule).not.toMatch(/(?:^|\s)border(?:-|:)/)
    expect(embeddedLabelRule).not.toContain('text-transform')

    // Anchored to the start of a line so it finds the component's own rule
    // rather than the first selector that happens to end in this class: a
    // caller may scope a colour to `.some-cell .app-field__input`, and an
    // unanchored match read that rule and reported the shared chrome missing.
    const [, fieldInputRule] = appFieldStyles.match(/^\.app-field__input\s*\{([^}]*)\}/m) ?? []
    expect(fieldInputRule).toContain('border: 0')
    expect(fieldInputRule).toContain('background: transparent')

    for (const family of [
      '.prompt-dialog__input',
      '.macro-search',
      '.console-browser__search',
      '.dashboard-preset-select',
    ]) {
      expect(styles, `${family} must not restate the shared field chrome`).not.toMatch(
        new RegExp(`\\${family}\\s*\\{[^}]*(?:border-radius|min-height|background):`),
      )
    }
  })

  it("centralizes every slider on AppSlider, at AppField's own height per size", () => {
    expect(styles).toContain("@import './app-slider.css';")

    // Every hand-rolled slider shape this replaced is gone from the shared
    // stylesheet — a new consumer has nowhere to copy the old markup from.
    for (const dead of ['.control-slider', '.module-settings__range', '.gcode-range-field']) {
      expect(allStyles, `${dead} must not still be defined`).not.toContain(`${dead} {`)
      expect(allStyles, `${dead} must not still be defined`).not.toContain(`${dead},`)
    }

    // Row-a plus row-b plus the gap must equal AppField's own 44/48/52px total
    // at every size, so the two share one rhythm wherever a card mixes them.
    // Measured here in the same rem units both stylesheets already use, rather
    // than trusting a browser layout the guardrail cannot run.
    const [, rootRule] = appSliderStyles.match(/^\.app-slider\s*\{([^}]*)\}/m) ?? []
    expect(rootRule, 'the complete AppSlider geometry rule is missing').toBeDefined()
    expect(rootRule).toContain('--app-slider-row-a-block-size: 1.25rem')
    expect(rootRule).toContain('--app-slider-row-b-block-size: 1.5rem')
    expect(rootRule).toContain('--app-slider-gap: 0.25rem')
    // sm: 1.25 + 1.5 + 0.25 = 3rem = 48px, matching AppField's own sm total.
    const [, xsRule] = appSliderStyles.match(/\.app-slider--size-xs\s*\{([^}]*)\}/) ?? []
    // xs: 1.0625 + 1.5 + 0.1875 = 2.75rem = 44px.
    expect(xsRule).toContain('--app-slider-row-a-block-size: 1.0625rem')
    expect(xsRule).toContain('--app-slider-gap: 0.1875rem')
    const [, mdRule] = appSliderStyles.match(/\.app-slider--size-md\s*\{([^}]*)\}/) ?? []
    // md: 1.375 + 1.625 + 0.25 = 3.25rem = 52px.
    expect(mdRule).toContain('--app-slider-row-a-block-size: 1.375rem')
    expect(mdRule).toContain('--app-slider-row-b-block-size: 1.625rem')

    // Content and clearance are decoupled, matching AppField's own split
    // between its box-block-size and its literal padding-block: adding space
    // must not mean growing row-a/row-b, since .app-slider__entry,
    // .app-slider__stepper, and .app-slider__track-wrap all stretch to fill
    // their row and would resize along with it. Whatever value it holds, it
    // is one flat knob rather than a per-size-tier one — AppField's own
    // envelope isn't tier dependent either.
    expect(rootRule).toMatch(/--app-slider-padding-block:\s*[\d.]+rem/)
    expect(rootRule).toContain('padding-block: var(--app-slider-padding-block)')
    expect(xsRule).not.toContain('--app-slider-padding-block')
    expect(mdRule).not.toContain('--app-slider-padding-block')

    // Reset and the steppers share one treatment — AppField's own documented
    // stepper exception, not the standard quiet-icon-button veil: chrome stays
    // transparent in every state, and only the glyph highlights.
    for (const control of ['.app-slider__reset', '.app-slider__stepper']) {
      const [, hoverBody] =
        appSliderStyles.match(
          new RegExp(
            `\\${control}:hover:not\\([^)]*\\),\\s*\\${control}:active:not\\([^)]*\\),\\s*\\${control}:focus-visible\\s*\\{([^}]*)\\}`,
          ),
        ) ?? []
      expect(hoverBody, `${control}'s hover/active/focus rule is missing`).toBeDefined()
      expect(hoverBody).toContain('background-color: transparent')
      expect(hoverBody).toContain('color: var(--text-primary)')
    }

    // The track's accent is the shared blue by default — the same one
    // `AppField`'s own border uses — with one documented, scoped exception
    // for the G-code viewer's playback scrubber, not a second invented hue.
    expect(appSliderStyles).toMatch(
      /background-color:\s*var\(--app-slider-accent,\s*var\(--action-primary\)\)/,
    )
    expect(styles).toMatch(
      /\.gcode-simulation-scrubber\s*\{[^}]*--app-slider-accent:\s*var\(--viewer-progress\)/,
    )
  })

  it('gives AppOutputRow a shorter tier than AppField/AppSlider and keeps .pin-row matched to it', () => {
    expect(styles).toContain("@import './app-output-row.css';")

    // The specific grid this replaced is gone; a new consumer has nowhere to
    // copy the old fan-table markup from.
    expect(styles, '.fan-table must not still be defined').not.toContain('.fan-table {')

    // 40/44/48px, a shorter scale than AppField/AppSlider's 44/48/52 — a row
    // with no border box needs less clearance than a field does.
    const [, rootRule] = appOutputRowStyles.match(/^\.app-output-row\s*\{([^}]*)\}/m) ?? []
    expect(rootRule, 'the complete AppOutputRow geometry rule is missing').toBeDefined()
    expect(rootRule).toContain('--app-output-row-block-size: 2.75rem')
    const [, xsRule] = appOutputRowStyles.match(/\.app-output-row--size-xs\s*\{([^}]*)\}/) ?? []
    expect(xsRule).toContain('--app-output-row-block-size: 2.5rem')
    const [, mdRule] = appOutputRowStyles.match(/\.app-output-row--size-md\s*\{([^}]*)\}/) ?? []
    expect(mdRule).toContain('--app-output-row-block-size: 3rem')

    // `.pin-row`/`.output-row` share one floor (main.css) at the `sm` tier
    // above, in the same units — a PWM row (still hand-rolled, `.pin-row`)
    // and an `AppSlider`/`AppOutputRow` (`.output-row`, split from `.pin-row`
    // so its own flex layout cannot collapse AppSlider's two-row anatomy)
    // must land on the same height or the list steps up and down.
    const [, pinRowRule] = styles.match(/\.pin-row,\s*\n?\.output-row\s*\{([^}]*)\}/) ?? []
    expect(pinRowRule, '.pin-row, .output-row rule is missing').toBeDefined()
    expect(pinRowRule).toContain('min-height: 2.75rem')

    // Split deliberately: `.output-row` never carries `.pin-row`'s own
    // `display: flex` layout rule, which is scoped to `.pin-row` alone.
    const [, layoutRule] = styles.match(/\.pin-row,\s*\n?\.queue-row[^{]*\{([^}]*)\}/) ?? []
    expect(layoutRule).not.toBeUndefined()
    expect(styles).not.toMatch(/\.output-row[^,{]*\{[^}]*display:\s*flex/)

    // The label is Title Case via CSS, not a rewritten string — a fan or pin
    // name is read straight from the printer's own config.
    expect(appOutputRowStyles).toMatch(
      /\.app-output-row__label\s*\{[^}]*text-transform:\s*capitalize/,
    )
  })

  it('never moves a control on hover or press', () => {
    // A hover transform is a reduced-motion defect: the reduced-motion block
    // collapses transition duration but leaves the transform in place.
    for (const [, body] of styles.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{([^{}]*)\}/g)) {
      expect(body ?? '').not.toMatch(/\btransform\s*:/)
    }
  })

  it('keeps a collapsing icon anchored instead of animating it to center', () => {
    // .sidebar-nav-link's inline padding is pinned so a collapsed link's
    // border-box exactly fits padding + icon + padding with nothing left over.
    // With no space left over, flex-start already reads as centered, so the
    // icon sits at the same offset whether the label is visible or gone — see
    // "Icon-only collapse" in docs/design/button-system.md. A justify-content
    // override that recenters on collapse would recompute that offset every
    // animation frame as the sidebar's width changes, making the icon visibly
    // slide; the padding must instead be declared exactly once for the
    // ordinary collapsed rail, never overridden there.
    //
    // The one bounded exception is minimal mode's own padding
    // (`[data-sidebar-minimal='true'] .sidebar-nav-link`), a second constant —
    // not a per-collapse-state override — that applies whether the rail is
    // collapsed or expanded, so expanding and collapsing within minimal mode
    // never touches padding either; see button-system.md's "Icon-only
    // collapse" exception. It is asserted by selector rather than merely
    // tolerated by count: exactly the base declaration and exactly this one
    // exception, nothing else.
    const paddingDeclarations = [...styles.matchAll(/\.sidebar-nav-link\s*\{[^}]*padding-inline:/g)]
    expect(paddingDeclarations).toHaveLength(2)

    const minimalPadding = [
      ...styles.matchAll(
        /\[data-sidebar-minimal='true'\][^{[]*\.sidebar-nav-link\s*\{[^}]*padding-inline:/g,
      ),
    ]
    expect(minimalPadding).toHaveLength(1)

    expect(styles).not.toMatch(
      /\[data-sidebar-collapsed='true'\][^{]*\.sidebar-nav-link\s*\{[^}]*justify-content/,
    )
  })

  it('keeps palette primitives out of the shared control rules', () => {
    const controlRules = [...styles.matchAll(/((?:\.button|\.segmented)[^{}]*)\{([^{}]*)\}/g)]

    expect(controlRules.length).toBeGreaterThan(10)
    for (const [, , body] of controlRules) {
      expect(body ?? '').not.toMatch(/--ito-|--neutral-white/)
    }
  })

  it('keeps chromatic palette primitives out of the shared stylesheet entirely', () => {
    // Shared CSS consumes semantic roles (--accent-primary, --status-*,
    // --viewer-*) or the documented data/brand aliases from
    // src/themes/tailwind.css. The only permitted primitive is --ito-black,
    // because neutral variation may be built from black/white with opacity —
    // shadows, backdrops, and mask gradients. A chromatic hue reached directly
    // bypasses the theme-pack contract and cannot be retinted by a pack.
    const primitives = [...styles.matchAll(/var\((--ito-[a-z-]+)/g)].map(([, name]) => name)

    expect(primitives.length).toBeGreaterThan(0)
    for (const name of primitives) {
      expect(name).toBe('--ito-black')
    }
  })

  it('never calls a browser-native popup anywhere in the application', () => {
    // The hard rule in docs/design/dialog-system.md: every confirmation, text
    // input, and multi-choice popup is Alabaster chrome, never OS chrome. The
    // copy passed to a native popup is easy to localize correctly, which is
    // exactly why the chrome mistake needs a mechanical check.
    const forbiddenCalls = ['confirm', 'prompt', 'alert'].map((name) => `window.${name}(`)

    for (const path of filesBelow(sourceRoot).filter(
      (candidate) => candidate.endsWith('.vue') || candidate.endsWith('.ts'),
    )) {
      const source = readFileSync(path, 'utf8')
      for (const call of forbiddenCalls) {
        expect(source, `${relative(sourceRoot, path)} must not call ${call})`).not.toContain(call)
      }
    }
  })

  it('keeps the one multi-choice dialog on the documented shell and button rules', () => {
    const dialogSource = readFileSync(
      join(sourceRoot, 'components', 'UpdateRecoveryDialog.vue'),
      'utf8',
    )
    const dialogSystem = designDoc('dialog-system.md')

    // The shared shell: a native dialog driven by a prop watcher, not by a
    // template handler calling showModal() directly.
    expect(dialogSource).toContain('<dialog')
    expect(dialogSource).toContain('class="confirm-dialog update-recovery-dialog"')
    expect(dialogSource).toMatch(/watch\(\s*isOpen,[\s\S]*element\.showModal\(\)/)
    expect(dialogSource).toContain("{ flush: 'post' }")
    expect(dialogSource).toContain('@cancel.prevent')
    expect(dialogSource).toContain('onBeforeUnmount')
    expect(dialogSource).toContain('aria-labelledby="update-recovery-title"')
    expect(dialogSource).toContain('aria-describedby="update-recovery-description"')

    /*
     * No dialog styles its own buttons, and a multi-choice dialog stacks them
     * full-width rather than sharing the binary two-column track.
     *
     * Read off `AppButton`'s props rather than a class string: the component is
     * the only thing that composes those classes now, so a class string in a
     * dialog would mean a hand-rolled control had come back — which the
     * "builds every control from AppButton" test below fails on its own.
     */
    const actions = [...dialogSource.matchAll(/<AppButton\b([\s\S]*?)\/?>/g)].map(([, a]) => a)
    expect(actions.length).toBeGreaterThan(2)
    for (const attrs of actions) expect(attrs).toMatch(/(?:^|\s)block(?:\s|$)/)

    // At most one danger, no primary, and the dismissive action last and quietest.
    expect(actions.filter((a) => /variant="danger"/.test(a))).toHaveLength(1)
    expect(actions.filter((a) => /variant="primary"/.test(a))).toHaveLength(0)
    expect(actions.at(-1)).toMatch(/variant="quiet"/)

    expect(styles).toMatch(
      /\.update-recovery-dialog__actions\s*\{[^}]*display:\s*grid[^}]*gap:\s*0\.5rem/s,
    )
    // Registered as an outlier in the same document that permits the pattern.
    if (dialogSystem) {
      expect(dialogSystem).toContain('## Multi-choice instances')
      expect(dialogSystem).toContain('UpdateRecoveryDialog.vue')
    }
  })

  it('scales a button icon to its button size, not to the author of the moment', () => {
    /*
     * button-system.md fixes the icon to the control size: 1.25rem inside md,
     * 1rem inside sm and xs. The product drifted to 1rem everywhere before this
     * was first enforced, which left every md button with a visibly undersized
     * icon.
     *
     * `AppButton` now derives the size for anything passed as its `icon` prop,
     * so that half of the rule holds by construction. What this guards is the
     * other half: a glyph handed to the default slot, where the component
     * cannot size it and the author writes the class themselves. That is the
     * same hole the class-string era had, narrowed to the sites that still
     * need a slot — a glyph beside other content, or one of the two outliers.
     */
    const offenders: string[] = []

    /*
     * Outlier 7: the console send button, an icon-only `sm` whose glyph is the
     * only thing it has to say. Listed by file so a second oversized icon
     * anywhere else still fails, and asserted against the document below so the
     * exception cannot exist in the code alone.
     */
    const oversizedDenseIcons = new Set(['components/console/ConsoleCommandInput.vue'])
    /*
     * Outlier 8: `button--icon-lg` buys glyph size with padding rather than
     * height, for the one control whose icon carries meaning no label does.
     */
    const largeIconButtons = new Set(['App.vue'])
    const buttonSystem = designDoc('button-system.md')

    for (const path of filesBelow(sourceRoot).filter((file) => file.endsWith('.vue'))) {
      const source = readFileSync(path, 'utf8')
      const name = relative(sourceRoot, path).replace(/\\/g, '/')
      for (const { attrs, body } of appButtons(source)) {
        const size = /\bsize="(\w+)"/.exec(attrs)?.[1] ?? 'md'
        const isLarge = /(?:^|\s)icon-lg(?:\s|$)/.test(attrs)
        if (isLarge && !largeIconButtons.has(name)) {
          offenders.push(`${name}: unregistered icon-lg`)
          continue
        }
        const want = size === 'md' || isLarge ? 'size-5' : 'size-4'
        for (const [, classes] of body.matchAll(/<AppIcon[^>]*class="([^"]*)"/g)) {
          const got = /size-[\d.]+/.exec(classes)?.[0]
          if (got === undefined || got === want) continue
          if (got === 'size-5' && oversizedDenseIcons.has(name)) continue
          offenders.push(`${name}: ${size} button with a ${got} slot icon`)
        }
      }
    }

    expect(offenders).toEqual([])

    // Registered as an outlier in the same document that permits the pattern.
    if (buttonSystem) {
      expect(buttonSystem).toContain('### 7. The console send button')
      expect(buttonSystem).toContain('ConsoleCommandInput.vue')
      expect(buttonSystem).toContain('### 8. Large icon buttons')
      expect(buttonSystem).toContain('`button--icon-lg`')
    }
  })

  it('builds every control from AppButton, never from a hand-written class string', () => {
    /*
     * `AppButton` is the only thing allowed to compose `button--*`. The failure
     * this prevents is the one the whole system was written against and did not
     * actually stop: a class string is just text, so nothing rejected an
     * illegal combination, and the four ways a hand-assembled control drifted
     * are listed in `AppButton.vue`'s own header. A component cannot be
     * half-assembled, so the drift has nowhere left to enter.
     *
     * The scan is for `button--*` in markup rather than for `<button>` itself,
     * because a native `<button>` is still correct for the patterns that
     * deliberately are not buttons — `file-select`, `text-action`,
     * `tab-select`, `brand-trigger`, the emergency stop, and the swatches. What
     * none of them may do is wear the button system's own classes.
     */
    const offenders: string[] = []

    /*
     * Three kinds of element still carry the classes by hand, and none of them
     * can be an `AppButton`, because `AppButton` renders a `<button>`:
     *
     * - `RouterLink` and `a` — a navigation destination and an external link.
     *   Outlier 6 in `button-system.md`; a link that renders as a `<button>`
     *   loses middle-click, Open in new tab, and the status-bar URL.
     * - `span` — the dashboard card's drag handle, which borrows the geometry
     *   and is deliberately not a control at all.
     *
     * So the rule is about the tag, not the file: a `<button>` never composes
     * these names, and the borrowers are listed rather than allowed by default.
     */
    const borrowers = new Set(['RouterLink', 'a', 'span'])

    for (const path of filesBelow(sourceRoot).filter((file) => file.endsWith('.vue'))) {
      const name = relative(sourceRoot, path).replace(/\\/g, '/')
      if (name === 'components/AppButton.vue') continue
      const source = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      const template = source.slice(source.indexOf('<template>'))
      for (const [, tag, attrs] of template.matchAll(/<([A-Za-z][\w-]*)((?:[^>"]|"[^"]*")*)>/g)) {
        if (!/\bbutton--[a-z-]+/.test(attrs)) continue
        if (borrowers.has(tag)) continue
        offenders.push(`${name}: <${tag}> composes button--* by hand`)
      }
    }

    expect(offenders).toEqual([])

    // The borrowed-geometry exception is registered in the document that grants it.
    const buttonSystem = designDoc('button-system.md')
    if (buttonSystem) {
      expect(buttonSystem).toContain('### 6. Primary navigation links')
      expect(buttonSystem).toContain('One borrowed shape that is not a control')
    }
  })

  /*
   * The settings panel's inset kept being written by hand, and getting it wrong is
   * invisible from the card — the damage only shows once the settings surface is
   * open. Both halves of the rule are mechanical, so neither needs to be caught by
   * eye again.
   */
  it('builds every registered module from AppDashboardModule', () => {
    /*
     * Every card body in the dashboard is this one shell, so the padding
     * rule, the inset rule, and the disclosure's gap-vs-margin rule all hold
     * by construction rather than by each module's author remembering them.
     * The list comes from the registry rather than from the directory: the
     * same folder holds panes, quick-settings rows, and pieces like
     * `MovementBedPlan` that are not cards and have no shell to build from.
     *
     * A module with no settings layer yet is included deliberately — the
     * shell costs it nothing (the panel is `v-if`-gated on an `open` that is
     * always false until the registry names its components) and adding that
     * layer later becomes a registry edit rather than a re-layout.
     */
    const registry = readFileSync(join(sourceRoot, 'dashboard', 'registry.ts'), 'utf8')
    const registered = [...registry.matchAll(/component: markRaw\((\w+)\)/g)].map(
      ([, name]) => name,
    )
    expect(registered.length).toBeGreaterThan(10)

    const offenders: string[] = []
    for (const name of registered) {
      const source = readFileSync(
        join(sourceRoot, 'components', 'dashboard', 'modules', `${name}.vue`),
        'utf8',
      )
      if (!/<AppDashboardModule\b/.test(source)) offenders.push(`${name}: no AppDashboardModule`)
      // Reaching past the shell to the panel steps around all three rules.
      if (/from ['"]@\/components\/dashboard\/ModuleSettingsPanel\.vue['"]/.test(source)) {
        offenders.push(`${name}: imports ModuleSettingsPanel directly`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps AppDashboardModule interchangeable by taking no class from any module', () => {
    /*
     * A class passed to the shell lands on its shared root, which is how the
     * shell stops being generic: `TemperaturesModule` and `MovementModule`
     * each put their own `@container` context there, and `ConsoleModule` a
     * flex column, so three of the eleven card bodies were not the same shape
     * as the other eight. A module that needs a box of its own renders it
     * inside the slot — `PrintModule`'s `print-card` is the reference — so the
     * content is a self-contained block that drops into any module unchanged.
     */
    const modulesRoot = join(sourceRoot, 'components', 'dashboard', 'modules')
    const shellTag = /<AppDashboardModule\b[^>]*>/g
    const offenders: string[] = []

    for (const path of filesBelow(modulesRoot).filter((file) => file.endsWith('.vue'))) {
      const name = relative(sourceRoot, path).replace(/\\/g, '/')
      for (const [tag] of readFileSync(path, 'utf8').matchAll(shellTag)) {
        if (/\bclass=|:class=/.test(tag)) offenders.push(`${name}: ${tag.replace(/\s+/g, ' ')}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('never lets AppDashboardModule override the settings panel padding, and shares the one inset', () => {
    const source = readFileSync(
      join(sourceRoot, 'components', 'dashboard', 'AppDashboardModule.vue'),
      'utf8',
    )
    const [tag] = /<ModuleSettingsPanel\b[^>]*>/.exec(source) ?? []
    expect(tag, 'AppDashboardModule must render ModuleSettingsPanel').toBeDefined()

    const classes = /:?class="([^"]*)"/.exec(tag ?? '')?.[1] ?? ''
    // Padding here lands on `.module-settings` and replaces its own interior,
    // leaving the box flush against the card edge instead of inset from it.
    expect(classes).not.toMatch(/\bp[xytrbl]?-\d/)
    expect(classes).not.toMatch(/padding/)
    // A hand-written margin is the copy that drifts; there is one class for it.
    expect(classes).not.toMatch(/\bm[xytrbl]?-\d/)

    expect(styles).toContain('.module-settings--inset')
    // Margin, not padding: the whole point of the class.
    expect(styles).toMatch(/\.module-settings--inset\s*\{[^}]*margin-inline:\s*1rem/)
    expect(styles).not.toMatch(/\.module-settings--inset\s*\{[^}]*padding/)
  })

  /*
   * `ModuleSettingsPanel` is `v-if`-gated (`DisclosureReveal`), so while its
   * close transition runs it is still a real sibling in whatever container
   * holds it — a CSS Grid/Flexbox `gap` reserves that sibling's full space on
   * both sides of it regardless of how small its own animated height gets,
   * and only stops once Vue actually removes it from the DOM at the end of
   * the transition. That produces a one-frame snap right after the height
   * animation already looked finished: `ExtruderModule`, `SpoolModule`,
   * `ControlsModule`, and `BedMeshModule` all shipped `class="grid gap-4
   * p-4"` and all showed it. `AppDashboardModule` now owns this: it renders
   * `ModuleSettingsPanel` on its own root, outside the inner content
   * wrapper, so no `gap`/`space-y-*` utility can ever span that boundary
   * again. See ADR 0004's disclosure exception.
   */
  it('keeps ModuleSettingsPanel outside any gap/space-y wrapper in AppDashboardModule', () => {
    const source = readFileSync(
      join(sourceRoot, 'components', 'dashboard', 'AppDashboardModule.vue'),
      'utf8',
    )
    const [, template] = /<template>([\s\S]*)<\/template>/.exec(source) ?? []
    expect(template, 'could not find the template').toBeDefined()

    // The wrapping div around everything must never itself carry gap/space-y
    // — that would once again span the boundary right after the panel.
    const [, rootTag] = /^\s*<div([^>]*)>/.exec(template ?? '') ?? []
    expect(rootTag).not.toMatch(/\bgap-\d/)
    expect(rootTag).not.toMatch(/\bspace-y-\d/)

    // ModuleSettingsPanel itself must render before the inner space-y-4
    // wrapper opens, never inside it.
    const panelIndex = (template ?? '').indexOf('<ModuleSettingsPanel')
    const wrapperIndex = (template ?? '').indexOf('class="space-y-4"')
    expect(panelIndex).toBeGreaterThan(-1)
    expect(wrapperIndex).toBeGreaterThan(-1)
    expect(panelIndex).toBeLessThan(wrapperIndex)
  })

  /*
   * SpoolModule.vue shipped the only `<style scoped>` block among the dashboard
   * modules — a `.spool-swatch` rule that duplicated `.filament-chip__swatch`
   * instead of sharing it, and stamped a Vue scope attribute onto every child it
   * rendered, including the settings row mounted through its slot. Every other
   * module already puts shared rules in main.css instead; this just makes that
   * the checked rule rather than the unstated norm.
   */
  it('lets no dashboard module own a <style> block of its own', () => {
    const modulesRoot = join(sourceRoot, 'components', 'dashboard', 'modules')
    const offenders: string[] = []

    for (const path of filesBelow(modulesRoot).filter((file) => file.endsWith('.vue'))) {
      const name = relative(sourceRoot, path).replace(/\\/g, '/')
      if (/<style[\s>]/.test(readFileSync(path, 'utf8'))) offenders.push(name)
    }

    expect(offenders).toEqual([])
  })

  /*
   * The mesh viewer's reset chip shipped visible but unclickable. It is
   * positioned, and the overlay canvas filling the same box raises itself to
   * catch the orbit — so a positioned sibling left on the default `auto`
   * painted below it however late it came in the markup, and every click
   * landed on a transparent canvas instead. The rule this asserts is the
   * general one: a control laid over that stage names its own layer.
   */
  it('keeps every control over the mesh stage above the canvas that catches the orbit', () => {
    const layerOf = (selector: string): number => {
      const body = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(styles)?.[1]
      expect(body, `${selector} has no rule in main.css`).toBeDefined()
      const layer = /z-index:\s*(-?\d+)/.exec(body ?? '')?.[1]
      expect(layer, `${selector} does not name a stacking layer`).toBeDefined()
      return Number(layer)
    }

    const overlay = layerOf('.mesh-canvas--overlay')
    const controls = [...new Set(styles.match(/\.mesh-stage__[\w-]+/g) ?? [])]
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(layerOf(control), `${control} sits under the overlay canvas`).toBeGreaterThan(overlay)
    }
  })

  it.skipIf(!designDoc('interface-standards.md'))(
    'documents the shared interaction and icon rules',
    () => {
      const standard = designDoc('interface-standards.md')
      expect(standard).toContain('## Interaction and iconography contract')
      expect(standard).toContain('Interface icons come from `AppIcon.vue`')
      expect(standard).toContain('every download action uses `download`')
    },
  )

  /*
   * A label that cannot shrink is a label that never truncates. With
   * `label-front` and `label-back` the label is a flex item of the field, so it
   * takes `min-width: auto` — an automatic minimum equal to its own min-content
   * width, which for `white-space: nowrap` text is the whole string. Without
   * this rule it held that width at every viewport, the ellipsis one level down
   * never engaged, and the value box was pushed clean out of the field instead:
   * Print's "Report drift past this many percent" ran its number input 59px past
   * the settings pane and 43px past the right edge of a 390px screen, where it
   * could be neither read nor reached. The two declarations are one mechanism —
   * the inner `min-width: 0` was never sufficient on its own, because an
   * intermediate flex item that cannot shrink stops the whole chain.
   *
   * `label-embed` is deliberately absent: that label is absolutely positioned,
   * so it is not a flex item and never had the automatic minimum to clear.
   */
  it('lets an outside field label shrink so its own ellipsis can engage', () => {
    expect(appFieldStyles).toMatch(
      /\.app-field--label-front > \.app-field__label,\s*\.app-field--label-back > \.app-field__label\s*{[^}]*min-width:\s*0/s,
    )
    expect(appFieldStyles).toMatch(
      /\.app-field--label-front > \.app-field__label \.app-field__label-text[^{]*{[^}]*text-overflow:\s*ellipsis/s,
    )
  })
})

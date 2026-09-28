/**
 * The rows of the configuration editor's context menu for one resolved target.
 *
 * Every row that appears can work: a row whose condition does not hold is left
 * out rather than shown disabled, because a greyed documentation link or pin
 * tells the reader nothing they can act on. The menu always has the same four
 * parts in the same order — a heading naming what was clicked, what only that
 * target makes possible, where to read about it, and editing — so a reader
 * learns once where things are. docs/design/configuration-editor.md holds the
 * reasoning for each part.
 *
 * Pure: the view gathers what the stores know into `EditorMenuFacts`, and the
 * rows come back as data — i18n keys, not words — so each condition is
 * testable without mounting the editor.
 */

import type { AppIconName } from '@/components/AppIcon.vue'
import {
  effectiveOption,
  optionKey,
  sectionKey,
  type ConfigIndex,
  type OptionOccurrence,
} from '@/features/config/optionLocator'
import { isPinnableOption, textOf } from '@/features/config/quickConfigFields'
import {
  commandReferenceUrl,
  configReferenceUrl,
  jinjaUrl,
  klipperGlobalTopic,
  sectionGuide,
  statusReferenceUrl,
  templateGuideUrl,
  type DocsSite,
  type DocsSiteAnchors,
} from '@/features/machine/docsLinks'
import type { EditorContext, LineRange } from '@/features/machine/editorContext'
import { expandIncludeTarget, isGlob, resolvableIncludeTarget } from '@/features/machine/includes'
import { runtimeCommandFor, type RuntimeCommand } from '@/features/machine/runtimeOptions'

export type EditorMenuAction =
  | { type: 'cut' }
  | { type: 'copy' }
  | { type: 'toggleComment' }
  | { type: 'commentLines'; range: LineRange }
  | { type: 'selectLines'; range: LineRange }
  | { type: 'selectSpan'; start: number; end: number }
  | { type: 'goTo'; path: string; line: number }
  | { type: 'openFile'; path: string }
  | { type: 'reveal'; path: string }
  | { type: 'createFile'; path: string }
  | { type: 'search'; query: string }
  | { type: 'pinOption'; section: string; option: string }
  | { type: 'unpinOption'; section: string; option: string }
  | { type: 'showInQuickConfig'; section: string; option: string }
  | { type: 'choosePins'; section: string }
  | { type: 'applyRuntime'; command: RuntimeCommand }
  | { type: 'goToLine' }
  | { type: 'shortcuts' }

export interface EditorMenuLabel {
  key: string
  params?: Record<string, string | number>
}

export interface EditorMenuItem {
  id: string
  label: EditorMenuLabel
  icon?: AppIconName
  /** Right-aligned and verbatim: a location, `printer.cfg:212`. */
  hint?: string
  /** A chord, as an i18n key, since how a key is named is the locale's: `Ctrl + klikk`. */
  hintKey?: string
  /** A link opens in a new tab; every other row runs `action`. */
  href?: string
  action?: EditorMenuAction
}

export interface EditorMenuFact {
  label: EditorMenuLabel
  caution?: boolean
}

export interface EditorMenu {
  /** What was clicked, verbatim, or null when there is nothing in particular to name. */
  heading: string | null
  facts: EditorMenuFact[]
  /** Keyed by what each holds, so a group that fills in late never shifts the others. */
  groups: Array<{ id: 'actions' | 'docs' | 'editing' | 'general'; items: EditorMenuItem[] }>
  /**
   * A printer object the heading reads a live value from, which the component
   * watches only while the menu is open.
   */
  watch: { object: string; attributes: string[] } | null
}

export interface EditorMenuFacts {
  /** The open file, relative to the config root. */
  path: string
  lines: readonly string[]
  readOnly: boolean
  /** The selected text, empty when the caret is a point. */
  selection: string
  site: DocsSite
  /** Null until the anchor table has loaded, which leaves documentation rows out. */
  anchors: DocsSiteAnchors | null
  /** Quick config's index of every included file; null until it has read them. */
  index: ConfigIndex | null
  /** Every file in the config root, or null until the listing has loaded. */
  files: readonly string[] | null
  /** Klipper's resolved `configfile.settings`, keyed by lower-cased section. */
  settings: Readonly<Record<string, unknown>>
  /** Whether `settings` is Klipper's answer rather than an empty placeholder. */
  settingsLoaded: boolean
  /**
   * The text of every option Klipper loaded, as written — compared against
   * the line rather than `settings`, whose typed values would call `5000`
   * and `5000.0` different.
   */
  loadedConfig: Readonly<Record<string, Readonly<Record<string, string>>>>
  pendingItems: Readonly<Record<string, Readonly<Record<string, string | undefined>>>>
  isPinned: (section: string, option: string) => boolean
  /** Section keys Quick config's picker can offer. */
  pinnableSections: ReadonlySet<string>
  /** Upper-case command name to its help text; null until Klipper has listed its commands. */
  commandHelp: ReadonlyMap<string, string> | null
  klipperReady: boolean
}

const MAX_LOCATIONS = 3
const HEADING_LENGTH = 48

function location(occurrence: { path: string; line: number }): string {
  return `${occurrence.path}:${occurrence.line + 1}`
}

function clip(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > HEADING_LENGTH ? `${line.slice(0, HEADING_LENGTH - 1)}…` : line
}

function sameValue(file: string, running: string): boolean {
  const left = file.replace(/\s+/g, '')
  const right = running.replace(/\s+/g, '')
  if (left.toLowerCase() === right.toLowerCase()) return true
  const leftNumber = Number(left)
  return left !== '' && Number.isFinite(leftNumber) && leftNumber === Number(right)
}

function goToItem(
  id: string,
  key: string,
  occurrence: { path: string; line: number },
): EditorMenuItem {
  return {
    id,
    label: { key },
    icon: 'forward',
    hint: location(occurrence),
    action: { type: 'goTo', path: occurrence.path, line: occurrence.line },
  }
}

/** A go-to row that names the section it lands on: `Go to [mcu EBBCan]`. */
function namedGoTo(
  id: string,
  occurrence: { path: string; line: number },
  section: string,
): EditorMenuItem {
  return {
    ...goToItem(id, 'configuration.editorMenu.goToNamedSection', occurrence),
    label: { key: 'configuration.editorMenu.goToNamedSection', params: { name: `[${section}]` } },
  }
}

/**
 * A TMC driver's stepper, or a stepper's TMC driver — the two halves of one
 * motor, configured in two sections that nothing on screen links.
 */
function counterpartSection(index: ConfigIndex | null, name: string) {
  if (!index) return null
  const [type = '', ...rest] = name.toLowerCase().split(' ')
  if (/^tmc\w+$/.test(type) && rest.length === 1) return writtenSection(index, rest[0] ?? '')
  if (!/^stepper_\w+$/.test(type) || rest.length > 0) return null
  for (const [candidate, entries] of index.sections) {
    const [driver = '', stepper] = candidate.split(' ')
    if (stepper !== type || !/^tmc\w+$/.test(driver)) continue
    const entry = entries.find((occurrence) => !occurrence.autosave)
    if (entry) return entry
  }
  return null
}

function link(id: string, label: EditorMenuLabel, href: string | null): EditorMenuItem[] {
  return href ? [{ id, label, icon: 'documentation', href }] : []
}

function isHere(occurrence: { path: string; line: number }, path: string, line: number): boolean {
  return occurrence.path === path && occurrence.line === line
}

/*
 * What Klipper registers for a macro that has no `description:` of its own.
 * Showing it would put the same two words on every undocumented macro.
 */
const PLACEHOLDER_HELP = 'G-Code macro'

function helpText(facts: EditorMenuFacts, command: string): string | null {
  const help = facts.commandHelp?.get(command.toUpperCase())?.trim()
  return help && help !== PLACEHOLDER_HELP ? help : null
}

/** Where a macro is defined: its `gcode:` line, or its header when the body is elsewhere. */
function macroDefinition(
  index: ConfigIndex | null,
  name: string,
): { path: string; line: number } | null {
  if (!index) return null
  const section = `gcode_macro ${name}`
  const body = effectiveOption(index, section, 'gcode')
  if (body)
    return (
      index.sections
        .get(sectionKey(section))
        ?.find((entry) => entry.path === body.path && entry.line <= body.line) ?? body
    )
  return index.sections.get(sectionKey(section))?.at(-1) ?? null
}

/** The first occurrence of a section outside the `SAVE_CONFIG` block. */
function writtenSection(index: ConfigIndex | null, section: string) {
  return index?.sections.get(sectionKey(section))?.find((entry) => !entry.autosave) ?? null
}

export function buildEditorMenu(context: EditorContext, facts: EditorMenuFacts): EditorMenu {
  const { target } = context
  const heading: string[] = []
  const menuFacts: EditorMenuFact[] = []
  const actions: EditorMenuItem[] = []
  const docs: EditorMenuItem[] = []
  const editing: EditorMenuItem[] = []
  let watch: EditorMenu['watch'] = null
  const writable = !facts.readOnly
  const { anchors, site, index } = facts
  const sectionName = context.section?.name ?? null
  const indexed = index?.files.includes(facts.path) ?? false
  const siteLabel = site === 'kalico' ? 'kalico' : 'klipper'

  function reference(section: string, option?: string): void {
    if (!anchors) return
    docs.push(
      ...link(
        'reference',
        {
          key: `configuration.editorMenu.reference.${siteLabel}`,
          params: { name: `[${section.split(' ')[0]}]` },
        },
        configReferenceUrl(site, anchors, section, option),
      ),
    )
  }

  function guide(section: string): void {
    const found = anchors ? sectionGuide(site, anchors, section) : null
    if (!found) return
    docs.push({
      id: 'guide',
      label: { key: `configuration.editorMenu.guide.${siteLabel}`, params: { title: found.title } },
      icon: 'documentation',
      href: found.url,
    })
  }

  function search(query: string, key = 'configuration.editorMenu.findUses'): void {
    if (!query.trim()) return
    actions.push({
      id: 'search',
      label: { key, params: { name: query } },
      icon: 'fileSearch',
      action: { type: 'search', query },
    })
  }

  switch (target.kind) {
    case 'section': {
      heading.push(target.commented ? `#[${target.name}]` : `[${target.name}]`)
      const key = sectionKey(target.name)
      const [type = '', ...rest] = target.name.split(' ')
      if (target.commented) {
        if (writable && context.sectionRange) {
          actions.push({
            id: 'uncommentSection',
            label: { key: 'configuration.editorMenu.uncommentSection' },
            action: { type: 'commentLines', range: context.sectionRange },
          })
        }
        reference(target.name)
        break
      }
      if (facts.settingsLoaded && !(key in facts.settings)) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.notLoaded' },
          caution: true,
        })
      }
      if (type.toLowerCase() === 'gcode_macro' && rest.length > 0) {
        const help = helpText(facts, rest.join(' '))
        if (help)
          menuFacts.push({
            label: { key: 'configuration.editorMenu.facts.text', params: { text: help } },
          })
      }
      if (facts.pinnableSections.has(key)) {
        actions.push({
          id: 'choosePins',
          label: { key: 'configuration.editorMenu.choosePins' },
          icon: 'pushpin',
          action: { type: 'choosePins', section: target.name },
        })
      }
      const others = (index?.sections.get(key) ?? []).filter(
        (entry) => !isHere(entry, facts.path, context.line),
      )
      for (const [position, entry] of others.slice(0, MAX_LOCATIONS).entries()) {
        actions.push(
          goToItem(`otherSection${position}`, 'configuration.editorMenu.otherDefinition', entry),
        )
      }
      const counterpart = counterpartSection(index, target.name)
      if (counterpart) actions.push(namedGoTo('counterpart', counterpart, counterpart.section))
      if (type.toLowerCase() === 'gcode_macro' && rest.length > 0) search(rest.join(' '))
      reference(target.name)
      guide(target.name)
      if (writable && context.sectionRange) {
        const range = context.sectionRange
        const allCommented = facts.lines
          .slice(range.from, range.to + 1)
          .filter((line) => line.trim() !== '')
          .every((line) => line.trimStart().startsWith('#'))
        editing.push({
          id: 'commentSection',
          label: {
            key: allCommented
              ? 'configuration.editorMenu.uncommentSection'
              : 'configuration.editorMenu.commentSection',
          },
          action: { type: 'commentLines', range },
        })
      }
      break
    }

    case 'option': {
      heading.push(target.option)
      const section = sectionName
      if (!section) break
      const key = sectionKey(section)
      const option = target.option.toLowerCase()
      const occurrences: readonly OptionOccurrence[] = indexed
        ? (index?.options.get(optionKey(section, option)) ?? [])
        : []
      const here = occurrences.find((entry) => isHere(entry, facts.path, context.line)) ?? null
      const effective = occurrences.at(-1) ?? null
      const resolved = textOf(
        (facts.settings[key] as Record<string, unknown> | undefined)?.[option],
      )
      const running = facts.loadedConfig[key]?.[option] ?? resolved

      if (here && effective && here !== effective) {
        menuFacts.push({
          label: effective.autosave
            ? { key: 'configuration.editorMenu.facts.savedBySaveConfig' }
            : {
                key: 'configuration.editorMenu.facts.overridden',
                params: { location: location(effective) },
              },
          caution: true,
        })
        actions.push(
          goToItem(
            'effective',
            effective.autosave
              ? 'configuration.editorMenu.goToSaved'
              : 'configuration.editorMenu.goToOverriding',
            effective,
          ),
        )
      } else if (
        !target.commented &&
        running !== null &&
        target.value &&
        !target.template &&
        !target.multiline &&
        !sameValue(target.value, running)
      ) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.running', params: { value: running } },
          caution: true,
        })
      } else if (target.commented && resolved !== null && occurrences.length === 0) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.default', params: { value: resolved } },
        })
      }
      if (facts.pendingItems[key]?.[option] !== undefined) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.pendingCalibration' },
          caution: true,
        })
      }
      if (here && here === effective) {
        const earlier = occurrences.filter((entry) => entry !== here)
        for (const [position, entry] of earlier.slice(-MAX_LOCATIONS).entries()) {
          actions.push(
            goToItem(`other${position}`, 'configuration.editorMenu.otherDefinition', entry),
          )
        }
      }

      const known = key in facts.settings || occurrences.length > 0
      if (!target.template && !target.multiline && known && isPinnableOption(section, option)) {
        if (facts.isPinned(key, option)) {
          actions.unshift(
            {
              id: 'showPin',
              label: { key: 'configuration.editorMenu.showInQuickConfig' },
              icon: 'popout',
              action: { type: 'showInQuickConfig', section: key, option },
            },
            {
              id: 'unpin',
              label: { key: 'configuration.editorMenu.unpin' },
              icon: 'close',
              action: { type: 'unpinOption', section: key, option },
            },
          )
        } else {
          actions.unshift({
            id: 'pin',
            label: { key: 'configuration.editorMenu.pin' },
            icon: 'pushpin',
            action: { type: 'pinOption', section: key, option },
          })
        }
      }

      const command =
        !target.commented && !target.template && facts.klipperReady
          ? runtimeCommandFor(section, option, target.value)
          : null
      if (command) {
        actions.push({
          id: 'apply',
          label: {
            key: 'configuration.editorMenu.applyUntilRestart',
            params: { value: target.value },
          },
          icon: 'bolt',
          action: { type: 'applyRuntime', command },
        })
      }

      const value = target.value.trim()
      const referenced = value && !target.template ? writtenSection(index, value) : null
      if (referenced && sectionKey(referenced.section) !== key) {
        actions.push(namedGoTo('referenced', referenced, referenced.section))
      }

      reference(section, option)
      if (writable && target.commented) {
        editing.push({
          id: 'uncomment',
          label: { key: 'configuration.editorMenu.uncomment' },
          action: { type: 'toggleComment' },
        })
      }
      break
    }

    case 'pin': {
      heading.push(target.pin)
      if (target.chip) {
        const mcu = writtenSection(index, `mcu ${target.chip}`)
        if (mcu) actions.push(namedGoTo('mcu', mcu, mcu.section))
      }
      search(target.chip ? `${target.chip}:${target.name}` : target.name)
      if (sectionName) reference(sectionName, target.option)
      break
    }

    case 'include': {
      heading.push(target.path)
      const files = facts.files
      if (isGlob(target.path)) {
        const matches = files ? expandIncludeTarget(facts.path, target.path, files) : []
        for (const [position, match] of matches.slice(0, 5).entries()) {
          actions.push({
            id: `open${position}`,
            label: { key: 'configuration.editorMenu.openNamed', params: { name: match } },
            icon: 'fileCode',
            action: { type: 'openFile', path: match },
          })
        }
        if (files && matches.length === 0) {
          menuFacts.push({
            label: { key: 'configuration.editorMenu.facts.noMatches' },
            caution: true,
          })
        }
      } else {
        const resolved = resolvableIncludeTarget(facts.path, target.path)
        if (resolved) {
          const exists = files ? files.includes(resolved) : null
          if (exists === false) {
            menuFacts.push({
              label: { key: 'configuration.editorMenu.facts.missingInclude' },
              caution: true,
            })
            if (writable) {
              actions.push({
                id: 'create',
                label: { key: 'configuration.editorMenu.createFile' },
                icon: 'filePlus',
                action: { type: 'createFile', path: resolved },
              })
            }
          } else {
            actions.push(
              {
                id: 'open',
                label: { key: 'configuration.editorMenu.openFile' },
                icon: 'fileCode',
                action: { type: 'openFile', path: resolved },
              },
              {
                id: 'reveal',
                label: { key: 'configuration.editorMenu.reveal' },
                icon: 'folder',
                action: { type: 'reveal', path: resolved },
              },
            )
          }
        }
      }
      reference('include')
      break
    }

    case 'command': {
      const name = target.name.toUpperCase()
      heading.push(name)
      const help = helpText(facts, name)
      const definition = macroDefinition(index, target.name)
      if (help) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.text', params: { text: help } },
        })
      } else if (
        facts.commandHelp &&
        facts.commandHelp.size > 0 &&
        !facts.commandHelp.has(name) &&
        !definition
      ) {
        menuFacts.push({
          label: { key: 'configuration.editorMenu.facts.unknownCommand' },
          caution: true,
        })
      }
      if (definition)
        actions.push(goToItem('definition', 'configuration.editorMenu.goToDefinition', definition))
      search(name)
      if (anchors) {
        docs.push(
          ...link(
            'commandReference',
            { key: `configuration.editorMenu.commandReference.${siteLabel}`, params: { name } },
            commandReferenceUrl(site, anchors, name),
          ),
        )
      }
      break
    }

    case 'printerPath': {
      heading.push(target.display)
      watch = { object: target.object, attributes: target.attributes }
      const macro = /^gcode_macro\s+(.+)$/i.exec(target.object)?.[1]
      if (macro) {
        const variable = target.attributes[0]
        const occurrence =
          variable && index ? effectiveOption(index, target.object, `variable_${variable}`) : null
        const definition = occurrence ?? macroDefinition(index, macro)
        if (definition) actions.push(namedGoTo('macro', definition, `gcode_macro ${macro}`))
      }
      if (anchors) {
        docs.push(
          ...link(
            'status',
            {
              key: `configuration.editorMenu.statusReference.${siteLabel}`,
              params: { name: target.object.split(' ')[0] ?? target.object },
            },
            statusReferenceUrl(site, anchors, target.object),
          ),
          ...link(
            'template',
            { key: `configuration.editorMenu.templateGuide.${siteLabel}` },
            templateGuideUrl(site, anchors, 'printer'),
          ),
        )
      }
      break
    }

    case 'templateGlobal': {
      heading.push(target.name)
      const topic = klipperGlobalTopic(target.name)
      if (anchors && topic) {
        docs.push(
          ...link(
            'template',
            { key: `configuration.editorMenu.templateGuide.${siteLabel}` },
            templateGuideUrl(site, anchors, topic),
          ),
        )
      }
      break
    }

    case 'jinja': {
      heading.push(target.name.name)
      docs.push(
        ...link(
          'jinja',
          {
            key: `configuration.editorMenu.jinja.${target.name.kind}`,
            params: { name: target.name.name },
          },
          jinjaUrl(target.name),
        ),
      )
      break
    }

    case 'delimiter': {
      heading.push(clip((facts.lines[context.line] ?? '').slice(target.start, target.end)))
      actions.push({
        id: 'selectBlock',
        label: { key: 'configuration.editorMenu.selectBlock' },
        action: { type: 'selectSpan', start: target.start, end: target.end },
      })
      break
    }

    case 'url': {
      heading.push(clip(target.href))
      actions.push({
        id: 'url',
        label: { key: 'configuration.editorMenu.openLink' },
        icon: 'globe',
        href: target.href,
      })
      break
    }

    case 'autogen': {
      heading.push(target.option ?? `[${target.section ?? ''}]`)
      menuFacts.push({ label: { key: 'configuration.editorMenu.facts.writtenBySaveConfig' } })
      if (target.section) {
        const written = target.option
          ? index?.options
              .get(optionKey(target.section, target.option))
              ?.find((entry) => !entry.autosave)
          : writtenSection(index, target.section)
        const fallback = target.option ? writtenSection(index, target.section) : null
        const destination = written ?? fallback
        if (destination) actions.push(namedGoTo('written', destination, target.section))
      }
      if (anchors) {
        docs.push(
          ...link(
            'saveConfig',
            {
              key: `configuration.editorMenu.commandReference.${siteLabel}`,
              params: { name: 'SAVE_CONFIG' },
            },
            commandReferenceUrl(site, anchors, 'SAVE_CONFIG'),
          ),
        )
      }
      break
    }

    case 'plain':
      break
  }

  if (context.templateBody && target.kind !== 'section') {
    editing.push({
      id: 'selectBody',
      label: { key: 'configuration.editorMenu.selectBody' },
      action: { type: 'selectLines', range: context.templateBody },
    })
  } else if (
    context.sectionRange &&
    (target.kind === 'option' ||
      target.kind === 'pin' ||
      (target.kind === 'section' && !target.commented))
  ) {
    editing.push({
      id: 'selectSection',
      label: { key: 'configuration.editorMenu.selectSection' },
      action: { type: 'selectLines', range: context.sectionRange },
    })
  }

  const selection = facts.selection
  if (selection && !selection.includes('\n')) {
    search(selection, 'configuration.editorMenu.searchFor')
  }
  if (!heading.length && selection) heading.push(clip(selection))

  const copyable = selection !== '' || context.span !== null
  const clipboard: EditorMenuItem[] = [
    ...(writable && selection
      ? [
          {
            id: 'cut',
            label: { key: 'configuration.editorMenu.cut' },
            hintKey: 'configuration.editorMenu.keys.cut',
            action: { type: 'cut' as const },
          },
        ]
      : []),
    ...(copyable
      ? [
          {
            id: 'copy',
            label: { key: 'configuration.editorMenu.copy' },
            icon: 'copyFile' as const,
            hintKey: 'configuration.editorMenu.keys.copy',
            action: { type: 'copy' as const },
          },
        ]
      : []),
    ...(writable && !editing.some((item) => item.id === 'uncomment')
      ? [
          {
            id: 'toggleComment',
            label: { key: 'configuration.editorMenu.toggleComment' },
            hintKey: 'configuration.shortcuts.items.comment.keys',
            action: { type: 'toggleComment' as const },
          },
        ]
      : []),
  ]
  const general: EditorMenuItem[] =
    target.kind === 'plain'
      ? [
          {
            id: 'goToLine',
            label: { key: 'configuration.editorMenu.goToLine' },
            action: { type: 'goToLine' },
          },
          {
            id: 'shortcuts',
            label: { key: 'configuration.editorMenu.shortcuts' },
            icon: 'help',
            hintKey: 'configuration.editorMenu.keys.shortcuts',
            action: { type: 'shortcuts' },
          },
        ]
      : []

  return {
    heading: heading[0] ?? null,
    facts: menuFacts,
    groups: [
      { id: 'actions' as const, items: actions },
      { id: 'docs' as const, items: docs },
      { id: 'editing' as const, items: [...clipboard, ...editing] },
      { id: 'general' as const, items: general },
    ].filter((group) => group.items.length > 0),
    watch,
  }
}

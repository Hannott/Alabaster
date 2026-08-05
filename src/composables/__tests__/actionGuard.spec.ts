import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useActionGuard } from '@/composables/useActionGuard'
import {
  confirmationKeys,
  printInterruptingKeys,
  useConfirmationsStore,
} from '@/stores/confirmations'

const sourceRoot = join(process.cwd(), 'src')

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })
}

const vueFiles = filesBelow(sourceRoot).filter(
  (path) => path.endsWith('.vue') && !path.includes('__tests__'),
)

describe('useActionGuard', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('escalates one step from the emphasis a control already had', () => {
    const cases = [
      ['neutral', null, 'button--danger'],
      ['primary', 'button--primary', 'button--danger'],
      ['danger-quiet', 'button--danger-quiet', 'button--danger'],
      ['danger', 'button--danger', 'button--critical'],
    ] as const

    for (const [emphasis, resting, escalated] of cases) {
      const skip = ref(false)
      const guard = useActionGuard({ tier: 'terminal', emphasis, moduleFlag: skip })

      expect(guard.variant.value, `${emphasis} guarded`).toBe(resting)
      skip.value = true
      expect(guard.variant.value, `${emphasis} unguarded`).toBe(escalated)
    }
  })

  /*
   * The failure this prevents is the one that started the whole pass: Cancel
   * print was already `danger`, the escalation table said there was nowhere
   * above it to go, and so a control whose confirmation had been switched off
   * looked exactly as it had when something was still going to catch a
   * misclick.
   */
  it('gives a danger control somewhere to escalate to', () => {
    const skip = ref(false)
    const guard = useActionGuard({ tier: 'terminal', moduleFlag: skip })

    expect(guard.variant.value).toBe('button--danger')
    skip.value = true
    expect(guard.variant.value).toBe('button--critical')
    expect(guard.variant.value).not.toBe('button--danger')
  })

  it('moves the mark and the livery in opposite directions, together', () => {
    const skip = ref(false)
    const guard = useActionGuard({ tier: 'terminal', moduleFlag: skip })

    expect(guard.bind.value['data-guard']).toBe('confirm')
    expect(guard.bind.value['aria-haspopup']).toBe('dialog')

    skip.value = true
    // No ellipsis and no ARIA relationship, because nothing is going to open.
    expect(guard.bind.value['data-guard']).toBeUndefined()
    expect(guard.bind.value['aria-haspopup']).toBeUndefined()
  })

  it('resolves a print-derived tier down to reversible when idle', () => {
    const printing = ref(false)
    const guard = useActionGuard({
      tier: () => (printing.value ? 'terminal' : 'reversible'),
      emphasis: 'neutral',
      key: 'restartKlipper',
    })

    // Idle: an ordinary action. No dialog, no mark, no livery -- a confirmation
    // here would ask about a risk that is not present, and that is the
    // interruption that teaches people to switch confirmations off.
    expect(guard.tier.value).toBe('reversible')
    expect(guard.guarded.value).toBe(false)
    expect(guard.bind.value).toEqual({})
    expect(guard.variant.value).toBeNull()

    printing.value = true
    expect(guard.tier.value).toBe('terminal')
    expect(guard.guarded.value).toBe(true)
    expect(guard.bind.value['data-guard']).toBe('confirm')
  })

  it('marks a disruptive control without asking it anything', () => {
    const printing = ref(true)
    const guard = useActionGuard({
      tier: () => (printing.value ? 'disruptive' : 'reversible'),
    })

    expect(guard.guarded.value).toBe(false)
    expect(guard.bind.value['data-tier']).toBe('disruptive')
    expect(guard.bind.value['data-guard']).toBeUndefined()

    printing.value = false
    expect(guard.bind.value['data-tier']).toBeUndefined()
  })

  it('gives a prompt trigger the mark and nothing else', () => {
    const guard = useActionGuard({ tier: 'reversible', prompt: true })

    expect(guard.bind.value['data-guard']).toBe('prompt')
    expect(guard.bind.value['aria-haspopup']).toBe('dialog')
    // Asking for a value is not itself a consequence.
    expect(guard.variant.value).toBe('button--danger')
  })

  it('answers all three levels, outermost first', () => {
    const confirmations = useConfirmationsStore()
    const guard = useActionGuard({ tier: 'terminal', key: 'clearJobQueue' })

    expect(guard.guarded.value).toBe(true)

    confirmations.setSkip('clearJobQueue', true)
    expect(guard.guarded.value).toBe(false)
    confirmations.setSkip('clearJobQueue', false)

    confirmations.setSkipGroup('printInterrupting', true)
    expect(guard.guarded.value).toBe(false)
    confirmations.setSkipGroup('printInterrupting', false)

    confirmations.setSkipAll(true)
    expect(guard.guarded.value).toBe(false)
  })

  it('restores a row rather than resetting it when an outer level goes off', () => {
    const confirmations = useConfirmationsStore()
    const guard = useActionGuard({ tier: 'terminal', key: 'clearJobQueue' })

    confirmations.setSkip('clearJobQueue', true)
    confirmations.setSkipAll(true)
    confirmations.setSkipAll(false)

    expect(guard.guarded.value).toBe(false)
    expect(confirmations.skipByKey.clearJobQueue).toBe(true)
  })
})

/*
 * The drift these catch is silent in both directions: a confirmation nobody can
 * switch off, and a setting row for a dialog that no longer opens. Neither
 * shows up as a broken build or a failing behaviour, so a structural assertion
 * is the only thing that sees them.
 */
describe('the guard system covers every control that needs it', () => {
  it('gives every ConfirmDialog instance a skip setting', () => {
    const unguarded: string[] = []

    for (const path of vueFiles) {
      const source = readFileSync(path, 'utf8')
      if (!source.includes('<ConfirmDialog')) continue

      // Either half of the documented split: a page-level key through the
      // store or the composable, or a module-local dashboard config flag.
      const hasGuard =
        source.includes('useActionGuard') ||
        source.includes('shouldConfirm(') ||
        /configBoolean\(config\.value, 'skip/.test(source)

      if (!hasGuard) unguarded.push(relative(sourceRoot, path))
    }

    expect(
      unguarded,
      `These files open a ConfirmDialog with no way to turn it off:\n${unguarded.join('\n')}`,
    ).toEqual([])
  })

  it('renders a row for every confirmation key', () => {
    const settings = readFileSync(join(sourceRoot, 'views', 'SettingsView.vue'), 'utf8')
    const locale = JSON.parse(
      readFileSync(join(sourceRoot, 'locales', 'en.json'), 'utf8'),
    ) as Record<string, { items?: Record<string, string> }>

    const missingRow = confirmationKeys.filter((key) => !settings.includes(`'${key}'`))
    const missingLabel = confirmationKeys.filter(
      (key) => locale.confirmations?.items?.[key] === undefined,
    )

    expect(missingRow, `Not listed in confirmationGroups: ${missingRow.join(', ')}`).toEqual([])
    expect(missingLabel, `No confirmations.items label: ${missingLabel.join(', ')}`).toEqual([])
  })

  it('keeps every grouped key a real key', () => {
    for (const key of printInterruptingKeys) {
      expect(confirmationKeys).toContain(key)
    }
  })

  /*
   * A variant written by hand at a call site can contradict the guard beside
   * it, which is exactly the state this pass found: two sites computing
   * `skipAll || skipXWarning ? 'button--danger' : 'button--primary'` inline for
   * the same decision, and a third -- Cancel -- computing nothing at all.
   */
  it('leaves no call site computing its own escalation', () => {
    const offenders: string[] = []

    for (const path of vueFiles) {
      const source = readFileSync(path, 'utf8')
      for (const line of source.split('\n')) {
        const escalatesByHand =
          /button--(danger|critical)/.test(line) && /skip[A-Z]|skipAll/.test(line)
        if (escalatesByHand) offenders.push(`${relative(sourceRoot, path)}: ${line.trim()}`)
      }
    }

    expect(
      offenders,
      `Derive the variant from useActionGuard instead:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

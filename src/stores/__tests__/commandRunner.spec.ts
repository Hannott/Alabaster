import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommandRunner } from '@/stores/commandRunner'
import { isHomingScript, summarizeScript, useCommandQueueStore } from '@/stores/commandQueue'
import { useCommandPreferencesStore } from '@/stores/commandPreferences'
import { useToastsStore } from '@/stores/toasts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe('command runner', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('refuses a second exclusive run of a key while the first is in flight', async () => {
    const runner = createCommandRunner(['home'] as const)
    const first = deferred()
    const running = runner.run('home', () => first.promise)

    await expect(runner.run('home', () => Promise.resolve())).resolves.toBe(false)
    expect(runner.pendingCommands.home).toBe(true)
    first.resolve()
    await expect(running).resolves.toBe(true)
    expect(runner.pendingCommands.home).toBe(false)
  })

  it('keeps a concurrent key pending until the last of its sends settles', async () => {
    const runner = createCommandRunner(['move'] as const)
    const first = deferred()
    const second = deferred()
    const one = runner.run('move', () => first.promise, { concurrent: true })
    const two = runner.run('move', () => second.promise, { concurrent: true })

    second.resolve()
    await two
    expect(runner.pendingCommands.move).toBe(true)
    first.resolve()
    await one
    expect(runner.pendingCommands.move).toBe(false)
  })

  it('lets a send from before a reset settle without touching the new state', async () => {
    const runner = createCommandRunner(['move'] as const)
    const old = deferred()
    const stale = runner.run('move', () => old.promise, { concurrent: true })
    runner.reset()
    const fresh = deferred()
    const current = runner.run('move', () => fresh.promise, { concurrent: true })

    old.resolve()
    await stale
    expect(runner.pendingCommands.move).toBe(true)
    fresh.resolve()
    await current
    expect(runner.pendingCommands.move).toBe(false)
  })

  it('skips the toast for a failure the caller claims, and still reports it failed', async () => {
    const runner = createCommandRunner(['move'] as const)
    const toasts = useToastsStore()

    await expect(
      runner.run('move', () => Promise.reject(new Error('gone')), { claimError: () => true }),
    ).resolves.toBe(false)
    expect(toasts.entries).toHaveLength(0)
    expect(runner.lastCommandError.value).toBe('move')
  })
})

describe('toasts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /** Queued presses settle together: five jogs past the limit are refused in one burst. */
  it('counts an identical message against the toast already showing it', () => {
    const toasts = useToastsStore()
    toasts.push('Move out of range')
    toasts.push('Move out of range')
    toasts.push('Something else')

    expect(toasts.entries.map((entry) => [entry.message, entry.count])).toEqual([
      ['Move out of range', 2],
      ['Something else', 1],
    ])
  })
})

describe('command queue', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists outstanding scripts oldest first and reports homing while a G28 waits', () => {
    const queue = useCommandQueueStore()
    const heat = queue.add('M190 S60', 'dashboard.modules.temperatures')
    const home = queue.add('G28 X\nM400', 'dashboard.modules.movement')

    expect(queue.entries.map((entry) => entry.script)).toEqual(['M190 S60', 'G28 X\nM400'])
    expect(queue.isHoming).toBe(true)
    queue.settle(home)
    expect(queue.isHoming).toBe(false)
    queue.settle(heat)
    expect(queue.entries).toEqual([])
  })

  it('collapses every script lost in one tick into a single toast', async () => {
    vi.useFakeTimers()
    try {
      const queue = useCommandQueueStore()
      queue.noteLost()
      queue.noteLost()
      await vi.runAllTimersAsync()
      expect(useToastsStore().entries).toHaveLength(1)
      expect(useToastsStore().entries[0]?.message).toContain('2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('finds a G28 on any line, in any case, but not a longer word', () => {
    expect(isHomingScript('M117 hi\ng28 z')).toBe(true)
    expect(isHomingScript('G28')).toBe(true)
    expect(isHomingScript('G280')).toBe(false)
  })

  it('drops the gcode-state housekeeping a jog wraps its move in', () => {
    expect(
      summarizeScript(
        'SAVE_GCODE_STATE NAME=_alabaster_movement\nG91\nG1 Z-0.1 F600\nRESTORE_GCODE_STATE NAME=_alabaster_movement',
      ),
    ).toBe('G91; G1 Z-0.1 F600')
  })
})

describe('command preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('queues by default with the header list hidden, and remembers a change', () => {
    const preferences = useCommandPreferencesStore()
    expect(preferences.dispatch).toBe('queue')
    expect(preferences.showQueue).toBe(false)

    preferences.setDispatch('wait')
    preferences.setShowQueue(true)
    setActivePinia(createPinia())
    const reloaded = useCommandPreferencesStore()
    expect(reloaded.dispatch).toBe('wait')
    expect(reloaded.showQueue).toBe(true)
  })

  it('repairs an invalid half of a replacement rather than writing it through', () => {
    const preferences = useCommandPreferencesStore()
    preferences.replace({ dispatch: 'sometimes', showQueue: true })
    expect(preferences.dispatch).toBe('queue')
    expect(preferences.showQueue).toBe(true)
  })
})

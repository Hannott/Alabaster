import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useConsoleWeight', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-console-weight')
    vi.resetModules()
  })

  it('defaults to regular', async () => {
    const { useConsoleWeight } = await import('@/composables/useConsoleWeight')
    const { mode } = useConsoleWeight()

    expect(mode.value).toBe('regular')
    expect(document.documentElement.dataset.consoleWeight).toBe('regular')
  })

  it('applies bold to the document, independent of the text weight setting', async () => {
    const { useConsoleWeight } = await import('@/composables/useConsoleWeight')
    const { setConsoleWeightMode } = useConsoleWeight()

    setConsoleWeightMode('bold')
    expect(document.documentElement.dataset.consoleWeight).toBe('bold')
  })

  it('persists the choice across a reload', async () => {
    const first = await import('@/composables/useConsoleWeight')
    first.useConsoleWeight().setConsoleWeightMode('bold')

    vi.resetModules()
    const second = await import('@/composables/useConsoleWeight')
    expect(second.useConsoleWeight().mode.value).toBe('bold')
  })
})

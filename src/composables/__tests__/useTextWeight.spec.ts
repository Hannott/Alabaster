import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useTextWeight', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-text-weight')
    vi.resetModules()
  })

  it('defaults to regular', async () => {
    const { useTextWeight } = await import('@/composables/useTextWeight')
    const { mode } = useTextWeight()

    expect(mode.value).toBe('regular')
    expect(document.documentElement.dataset.textWeight).toBe('regular')
  })

  it('applies the chosen mode to the document', async () => {
    const { useTextWeight } = await import('@/composables/useTextWeight')
    const { setTextWeightMode } = useTextWeight()

    setTextWeightMode('light')
    expect(document.documentElement.dataset.textWeight).toBe('light')
  })

  it('persists the choice across a reload', async () => {
    const first = await import('@/composables/useTextWeight')
    first.useTextWeight().setTextWeightMode('medium')

    vi.resetModules()
    const second = await import('@/composables/useTextWeight')
    expect(second.useTextWeight().mode.value).toBe('medium')
  })

  it('falls back to the default for an unrecognized stored value', async () => {
    window.localStorage.setItem('alabaster.textWeight', 'standard')
    const { useTextWeight } = await import('@/composables/useTextWeight')

    expect(useTextWeight().mode.value).toBe('regular')
  })
})

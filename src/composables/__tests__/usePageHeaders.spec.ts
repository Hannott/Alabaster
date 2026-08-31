import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('usePageHeaders', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('defaults to show', async () => {
    const { usePageHeaders } = await import('@/composables/usePageHeaders')
    const { mode } = usePageHeaders()

    expect(mode.value).toBe('show')
  })

  it('persists the choice across a reload', async () => {
    const first = await import('@/composables/usePageHeaders')
    first.usePageHeaders().setPageHeaderVisibility('hide')

    vi.resetModules()
    const second = await import('@/composables/usePageHeaders')
    expect(second.usePageHeaders().mode.value).toBe('hide')
  })

  it('falls back to the default for an unrecognized stored value', async () => {
    window.localStorage.setItem('alabaster.pageHeaders', 'collapsed')
    const { usePageHeaders } = await import('@/composables/usePageHeaders')

    expect(usePageHeaders().mode.value).toBe('show')
  })
})

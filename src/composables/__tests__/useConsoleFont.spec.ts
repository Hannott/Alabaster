import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useConsoleFont', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-console-font')
    vi.resetModules()
  })

  it('defaults to matching the interface typeface, writing no attribute at all', async () => {
    const { useConsoleFont } = await import('@/composables/useConsoleFont')
    const { consoleFont } = useConsoleFont()

    expect(consoleFont.value).toBe('match')
    expect(document.documentElement.dataset.consoleFont).toBeUndefined()
  })

  it('naming a font sets the attribute independently of the interface typeface', async () => {
    const { useConsoleFont } = await import('@/composables/useConsoleFont')
    const { setConsoleFont } = useConsoleFont()

    setConsoleFont('openDyslexic')
    expect(document.documentElement.dataset.consoleFont).toBe('openDyslexic')
  })

  it('returning to "match" removes the attribute again', async () => {
    const { useConsoleFont } = await import('@/composables/useConsoleFont')
    const { setConsoleFont } = useConsoleFont()

    setConsoleFont('robotoMono')
    expect(document.documentElement.dataset.consoleFont).toBe('robotoMono')

    setConsoleFont('match')
    expect(document.documentElement.dataset.consoleFont).toBeUndefined()
  })

  it('persists the choice across a reload', async () => {
    const first = await import('@/composables/useConsoleFont')
    first.useConsoleFont().setConsoleFont('publicSans')

    vi.resetModules()
    const second = await import('@/composables/useConsoleFont')
    expect(second.useConsoleFont().consoleFont.value).toBe('publicSans')
    expect(document.documentElement.dataset.consoleFont).toBe('publicSans')
  })

  it('falls back to "match" for an unrecognized stored value', async () => {
    window.localStorage.setItem('alabaster.consoleFont', 'not-a-real-font')
    const { useConsoleFont } = await import('@/composables/useConsoleFont')

    expect(useConsoleFont().consoleFont.value).toBe('match')
  })
})

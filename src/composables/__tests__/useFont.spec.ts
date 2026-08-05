import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useFont', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-font')
    vi.resetModules()
  })

  it('defaults to Source Code Pro, not the dyslexia-friendly font', async () => {
    const { useFont } = await import('@/composables/useFont')
    const { fontId } = useFont()

    expect(fontId.value).toBe('sourceCodePro')
    expect(document.documentElement.dataset.font).toBe('sourceCodePro')
  })

  it('applies the chosen font to the document', async () => {
    const { useFont } = await import('@/composables/useFont')
    const { setFontId } = useFont()

    setFontId('openDyslexic')
    expect(document.documentElement.dataset.font).toBe('openDyslexic')
  })

  it('persists the choice across a reload', async () => {
    const first = await import('@/composables/useFont')
    first.useFont().setFontId('publicSans')

    vi.resetModules()
    const second = await import('@/composables/useFont')
    expect(second.useFont().fontId.value).toBe('publicSans')
    expect(document.documentElement.dataset.font).toBe('publicSans')
  })

  it('falls back to the default for an unrecognized stored value', async () => {
    window.localStorage.setItem('alabaster.font', 'not-a-real-font')
    const { useFont } = await import('@/composables/useFont')

    expect(useFont().fontId.value).toBe('sourceCodePro')
  })

  it('lists every registered font once, none of them selected as the dyslexia default', async () => {
    const { useFont } = await import('@/composables/useFont')
    const { fonts } = useFont()

    expect(fonts.map((font) => font.id)).toEqual([
      'sourceCodePro',
      'robotoMono',
      'overpassMono',
      'publicSans',
      'openDyslexic',
    ])
    expect(fonts.find((font) => font.dyslexiaFriendly)?.id).toBe('openDyslexic')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { useGcodeViewerSettings } from '@/composables/useGcodeViewerSettings'

describe('G-code viewer settings', () => {
  const settings = useGcodeViewerSettings()

  beforeEach(() => {
    settings.setOrbitMode('center')
    settings.setSnapToCenter(false)
    settings.setHighlightSeams(false)
  })

  it('persists the orbit mode locally', () => {
    settings.setOrbitMode('pointer')

    expect(settings.orbitMode.value).toBe('pointer')
    expect(localStorage.getItem('alabaster.gcodeViewer.orbitMode')).toBe('pointer')

    settings.setOrbitMode('center')

    expect(settings.orbitMode.value).toBe('center')
    expect(localStorage.getItem('alabaster.gcodeViewer.orbitMode')).toBe('center')
  })

  it('persists the toggles locally', () => {
    settings.setSnapToCenter(true)
    settings.setHighlightSeams(true)

    expect(settings.snapToCenter.value).toBe(true)
    expect(settings.highlightSeams.value).toBe(true)
    expect(localStorage.getItem('alabaster.gcodeViewer.snapToCenter')).toBe('true')
    expect(localStorage.getItem('alabaster.gcodeViewer.highlightSeams')).toBe('true')

    settings.setSnapToCenter(false)

    expect(settings.snapToCenter.value).toBe(false)
    expect(localStorage.getItem('alabaster.gcodeViewer.snapToCenter')).toBe('false')
  })

  it('shares every setting across callers', () => {
    settings.setOrbitMode('pointer')
    settings.setHighlightSeams(true)

    expect(useGcodeViewerSettings().orbitMode.value).toBe('pointer')
    expect(useGcodeViewerSettings().highlightSeams.value).toBe(true)
  })
})

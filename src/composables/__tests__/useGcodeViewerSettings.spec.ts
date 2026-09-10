import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultGcodeTierCeiling } from '@/features/gcode/quality'

/**
 * The composable reads storage once, at module scope, so every test here gets a
 * fresh module: that read is exactly the behaviour under test, and a shared
 * instance would only ever exercise the first one. Which is also the reason the
 * fallbacks matter — a stored value can be anything a previous version of the
 * viewer wrote, or anything a person typed into their own devtools, and a
 * viewer that opened with `undefined` for a colour mode would render nothing.
 */

const keys = {
  colorMode: 'alabaster.gcodeViewer.colorMode',
  showTravels: 'alabaster.gcodeViewer.showTravels',
  qualityMode: 'alabaster.gcodeViewer.qualityMode',
  followByDefault: 'alabaster.gcodeViewer.followByDefault',
  nozzleDiameter: 'alabaster.gcodeViewer.nozzleDiameter',
  tierCeiling: 'alabaster.gcodeViewer.tierCeiling',
}

async function freshSettings() {
  vi.resetModules()
  const module = await import('@/composables/useGcodeViewerSettings')
  return module.useGcodeViewerSettings()
}

describe('G-code viewer settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('opens with the documented defaults on a browser that has never seen the viewer', async () => {
    const settings = await freshSettings()

    expect(settings.colorMode.value).toBe('single')
    expect(settings.showTravels.value).toBe(false)
    expect(settings.qualityMode.value).toBe('auto')
    expect(settings.nozzleDiameterOverride.value).toBeNull()
    expect(settings.tierCeiling.value).toBe(defaultGcodeTierCeiling)
  })

  it('gives every setting its own key, so one of them cannot overwrite another', async () => {
    const settings = await freshSettings()

    settings.setColorMode('feature')
    settings.setShowTravels(true)
    settings.setQualityMode('performance')
    settings.setFollowByDefault(false)
    settings.setNozzleDiameterOverride(0.6)
    settings.setTierCeiling(2)

    expect(window.localStorage.getItem(keys.colorMode)).toBe('feature')
    expect(window.localStorage.getItem(keys.showTravels)).toBe('true')
    expect(window.localStorage.getItem(keys.qualityMode)).toBe('performance')
    expect(window.localStorage.getItem(keys.followByDefault)).toBe('false')
    expect(window.localStorage.getItem(keys.nozzleDiameter)).toBe('0.6')
    expect(window.localStorage.getItem(keys.tierCeiling)).toBe('2')
  })

  it('reads every setting back on the next visit', async () => {
    const first = await freshSettings()
    first.setColorMode('feedrate')
    first.setShowTravels(true)
    first.setQualityMode('quality')
    first.setFollowByDefault(false)
    first.setNozzleDiameterOverride(0.8)
    first.setTierCeiling(3)

    const second = await freshSettings()

    expect(second.colorMode.value).toBe('feedrate')
    expect(second.showTravels.value).toBe(true)
    expect(second.qualityMode.value).toBe('quality')
    expect(second.followByDefault.value).toBe(false)
    expect(second.nozzleDiameterOverride.value).toBe(0.8)
    expect(second.tierCeiling.value).toBe(3)
  })

  it('shares one instance across callers, so two panes cannot disagree', async () => {
    vi.resetModules()
    const module = await import('@/composables/useGcodeViewerSettings')
    module.useGcodeViewerSettings().setColorMode('feature')

    expect(module.useGcodeViewerSettings().colorMode.value).toBe('feature')
  })

  it('falls back to the documented default for a stored value it cannot use', async () => {
    window.localStorage.setItem(keys.colorMode, 'rainbow')
    window.localStorage.setItem(keys.qualityMode, 'fastest')
    window.localStorage.setItem(keys.nozzleDiameter, 'not-a-number')
    window.localStorage.setItem(keys.tierCeiling, '9')

    const settings = await freshSettings()

    expect(settings.colorMode.value).toBe('single')
    expect(settings.qualityMode.value).toBe('auto')
    expect(settings.nozzleDiameterOverride.value).toBeNull()
    expect(settings.tierCeiling.value).toBe(defaultGcodeTierCeiling)
  })

  /**
   * Following a running print is what most people open the viewer for, so this
   * is the one setting whose absence has to mean "on". Reading it as a plain
   * truthiness check would leave a first visit following nothing.
   */
  it('follows a print by default, and only an explicit false turns it off', async () => {
    expect((await freshSettings()).followByDefault.value).toBe(true)

    for (const stored of ['true', '', '0', 'no', 'FALSE']) {
      window.localStorage.setItem(keys.followByDefault, stored)
      expect((await freshSettings()).followByDefault.value).toBe(true)
    }

    window.localStorage.setItem(keys.followByDefault, 'false')
    expect((await freshSettings()).followByDefault.value).toBe(false)
  })

  /**
   * The override exists for local files inspected with no printer connected,
   * and for a machine whose config does not match its hardware. Null means "use
   * the machine's own", which is why clearing it has to remove the key rather
   * than write a zero that would read back as a real bead width.
   */
  describe('nozzle diameter override', () => {
    it('clamps to a width a real nozzle could have', async () => {
      const settings = await freshSettings()

      settings.setNozzleDiameterOverride(0.01)
      expect(settings.nozzleDiameterOverride.value).toBe(0.1)

      settings.setNozzleDiameterOverride(40)
      expect(settings.nozzleDiameterOverride.value).toBe(2)

      settings.setNozzleDiameterOverride(0.4)
      expect(settings.nozzleDiameterOverride.value).toBe(0.4)
    })

    it('removes the key entirely when the override is cleared', async () => {
      const settings = await freshSettings()
      settings.setNozzleDiameterOverride(0.6)

      settings.setNozzleDiameterOverride(null)

      expect(settings.nozzleDiameterOverride.value).toBeNull()
      expect(window.localStorage.getItem(keys.nozzleDiameter)).toBeNull()
    })

    it('treats a nonsensical width as no override rather than as a bead of that size', async () => {
      const settings = await freshSettings()

      for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        settings.setNozzleDiameterOverride(0.6)
        settings.setNozzleDiameterOverride(width)
        expect(settings.nozzleDiameterOverride.value).toBeNull()
        expect(window.localStorage.getItem(keys.nozzleDiameter)).toBeNull()
      }
    })
  })

  /**
   * The ceiling is a fact this browser learned about its own hardware, and it
   * is only ever allowed to move downward: a machine that struggled once has
   * told us something, while a machine that had one fast minute has not. A
   * ceiling that could climb again would reintroduce the stutter the user just
   * watched the viewer fix.
   */
  describe('tier ceiling', () => {
    it('lowers one rung at a time and stops at the cheapest tier', async () => {
      const settings = await freshSettings()

      expect(settings.lowerTierCeiling()).toBe(defaultGcodeTierCeiling - 1)
      expect(settings.tierCeiling.value).toBe(defaultGcodeTierCeiling - 1)
      expect(window.localStorage.getItem(keys.tierCeiling)).toBe(
        String(defaultGcodeTierCeiling - 1),
      )

      for (let attempt = 0; attempt < 10; attempt += 1) settings.lowerTierCeiling()

      expect(settings.tierCeiling.value).toBe(1)
      expect(settings.lowerTierCeiling()).toBe(1)
    })

    it('never rises, whatever it is asked for', async () => {
      const settings = await freshSettings()
      settings.setTierCeiling(2)

      expect(settings.lowerTierCeiling()).toBe(1)
      expect(settings.lowerTierCeiling()).toBe(1)
    })

    it('survives the visit that learned it', async () => {
      const first = await freshSettings()
      first.lowerTierCeiling()
      first.lowerTierCeiling()

      expect((await freshSettings()).tierCeiling.value).toBe(defaultGcodeTierCeiling - 2)
    })
  })

  /**
   * Three settings the viewer no longer has: both orbit-pivot options needed a
   * per-frame geometry pick the library-backed renderer does not do, and seam
   * highlighting was a property of shaders Alabaster no longer owns. They are
   * cleared rather than ignored so a browser that has been through the old
   * viewer does not carry three dead entries for the rest of its life.
   */
  it('clears the settings the viewer retired', async () => {
    const retired = [
      'alabaster.gcodeViewer.orbitMode',
      'alabaster.gcodeViewer.snapToCenter',
      'alabaster.gcodeViewer.highlightSeams',
    ]
    for (const key of retired) window.localStorage.setItem(key, 'pointer')
    window.localStorage.setItem(keys.colorMode, 'feature')

    const settings = await freshSettings()

    for (const key of retired) expect(window.localStorage.getItem(key)).toBeNull()
    // Only the retired keys: a migration that cleared the namespace would take
    // the surviving preferences with it.
    expect(settings.colorMode.value).toBe('feature')
    expect(window.localStorage.getItem(keys.colorMode)).toBe('feature')
  })
})

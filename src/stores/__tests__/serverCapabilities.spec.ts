import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'

describe('server capabilities store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('treats everything as present until Moonraker has reported', () => {
    const capabilities = useServerCapabilitiesStore()

    expect(capabilities.hasReported).toBe(false)
    expect(capabilities.hasComponent('history')).toBe(true)
    expect(capabilities.hasRoot('config')).toBe(true)
  })

  it('answers from what Moonraker reported', () => {
    const capabilities = useServerCapabilitiesStore()

    capabilities.applyServerInfo({
      components: ['history', 'file_manager'],
      registered_directories: ['gcodes', 'config'],
    })

    expect(capabilities.hasReported).toBe(true)
    expect(capabilities.hasComponent('history')).toBe(true)
    expect(capabilities.hasComponent('timelapse')).toBe(false)
    expect(capabilities.hasRoot('config')).toBe(true)
    expect(capabilities.hasRoot('timelapse')).toBe(false)
  })

  it('distinguishes an empty report from no report', () => {
    const capabilities = useServerCapabilitiesStore()

    capabilities.applyServerInfo({ components: [], registered_directories: [] })

    expect(capabilities.hasComponent('history')).toBe(false)
    expect(capabilities.hasRoot('config')).toBe(false)
  })

  /**
   * A response that omits a list — an older Moonraker, or a trimmed reply — must
   * not erase what a previous one told us, or a destination would disappear from
   * the rail because of the shape of one reconnect's payload.
   */
  it('keeps the last known lists when a report omits them', () => {
    const capabilities = useServerCapabilitiesStore()

    capabilities.applyServerInfo({
      components: ['history'],
      registered_directories: ['config'],
    })
    capabilities.applyServerInfo({})

    expect(capabilities.hasComponent('history')).toBe(true)
    expect(capabilities.hasRoot('config')).toBe(true)
    expect(capabilities.hasComponent('timelapse')).toBe(false)
  })

  it('ignores entries that are not strings rather than trusting the payload', () => {
    const capabilities = useServerCapabilitiesStore()

    capabilities.applyServerInfo({
      components: ['history', 7, null] as unknown as string[],
      registered_directories: 'config' as unknown as string[],
    })

    expect(capabilities.components).toEqual(['history'])
    expect(capabilities.registeredRoots).toBeNull()
  })

  it('replaces the lists on a later report instead of merging them', () => {
    const capabilities = useServerCapabilitiesStore()

    capabilities.applyServerInfo({ components: ['timelapse'] })
    capabilities.applyServerInfo({ components: ['history'] })

    expect(capabilities.hasComponent('history')).toBe(true)
    expect(capabilities.hasComponent('timelapse')).toBe(false)
  })
})

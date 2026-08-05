import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Mirrors the real API: every `request()` call returns its own distinct sentinel. */
function createSentinel() {
  const releaseListeners: Array<() => void> = []
  return {
    released: false,
    addEventListener: (type: string, callback: () => void) => {
      if (type === 'release') releaseListeners.push(callback)
    },
    removeEventListener: () => undefined,
    release: vi.fn(async () => {
      releaseListeners.forEach((callback) => callback())
    }),
    triggerExternalRelease: () => releaseListeners.forEach((callback) => callback()),
  }
}

function stubWakeLock(opts: { fails?: boolean } = {}) {
  const sentinels: Array<ReturnType<typeof createSentinel>> = []
  const request = vi.fn(async () => {
    if (opts.fails) throw new Error('NotAllowedError')
    const sentinel = createSentinel()
    sentinels.push(sentinel)
    return sentinel
  })
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  return {
    request,
    /** The sentinel handed back by the most recent successful `request()` call. */
    latestSentinel: () => sentinels[sentinels.length - 1]!,
  }
}

function stubSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useWakeLock', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock
    Object.defineProperty(window, 'isSecureContext', { value: undefined, configurable: true })
    setHidden(false)
  })

  it('reports unsupported when the browser has no Wake Lock API', async () => {
    const { useWakeLock } = await import('@/composables/useWakeLock')
    expect(useWakeLock().isSupported).toBe(false)
  })

  it('reports insecure when not in a secure context, even if supported', async () => {
    stubWakeLock()
    stubSecureContext(false)
    const { useWakeLock } = await import('@/composables/useWakeLock')
    expect(useWakeLock().isSupported).toBe(true)
    expect(useWakeLock().isSecureContext).toBe(false)
  })

  it('never requests a lock when unsupported or insecure', async () => {
    const { request } = stubWakeLock()
    stubSecureContext(false)
    const { useWakeLock } = await import('@/composables/useWakeLock')
    useWakeLock().setEnabled(true)
    await vi.waitFor(() => expect(useWakeLock().enabled.value).toBe(true))
    expect(request).not.toHaveBeenCalled()
    expect(useWakeLock().isActive.value).toBe(false)
  })

  it('acquires a lock when enabled in a supported, secure context', async () => {
    const { request } = stubWakeLock()
    stubSecureContext(true)
    const { useWakeLock } = await import('@/composables/useWakeLock')

    useWakeLock().setEnabled(true)
    await vi.waitFor(() => expect(useWakeLock().isActive.value).toBe(true))
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('releases the lock when disabled', async () => {
    const { latestSentinel } = stubWakeLock()
    stubSecureContext(true)
    const { useWakeLock } = await import('@/composables/useWakeLock')

    useWakeLock().setEnabled(true)
    await vi.waitFor(() => expect(useWakeLock().isActive.value).toBe(true))

    useWakeLock().setEnabled(false)
    await vi.waitFor(() => expect(latestSentinel().release).toHaveBeenCalled())
    expect(useWakeLock().isActive.value).toBe(false)
  })

  it('stays inactive while the tab is hidden, and re-acquires once visible again', async () => {
    stubWakeLock()
    stubSecureContext(true)
    setHidden(true)
    const { useWakeLock } = await import('@/composables/useWakeLock')

    useWakeLock().setEnabled(true)
    expect(useWakeLock().isActive.value).toBe(false)

    setHidden(false)
    await vi.waitFor(() => expect(useWakeLock().isActive.value).toBe(true))
  })

  it('re-acquires after the browser silently revokes the lock and the tab is visible again', async () => {
    const { latestSentinel } = stubWakeLock()
    stubSecureContext(true)
    const { useWakeLock } = await import('@/composables/useWakeLock')

    useWakeLock().setEnabled(true)
    await vi.waitFor(() => expect(useWakeLock().isActive.value).toBe(true))

    latestSentinel().triggerExternalRelease()
    expect(useWakeLock().isActive.value).toBe(false)

    setHidden(true)
    setHidden(false)
    await vi.waitFor(() => expect(useWakeLock().isActive.value).toBe(true))
  })

  it('stays inactive when the request is refused', async () => {
    stubWakeLock({ fails: true })
    stubSecureContext(true)
    const { useWakeLock } = await import('@/composables/useWakeLock')

    useWakeLock().setEnabled(true)
    await vi.waitFor(() => expect(useWakeLock().enabled.value).toBe(true))
    expect(useWakeLock().isActive.value).toBe(false)
  })

  it('persists the preference across a reload', async () => {
    stubWakeLock()
    stubSecureContext(true)
    const first = await import('@/composables/useWakeLock')
    first.useWakeLock().setEnabled(true)

    vi.resetModules()
    stubWakeLock()
    stubSecureContext(true)
    const second = await import('@/composables/useWakeLock')
    expect(second.useWakeLock().enabled.value).toBe(true)
    await vi.waitFor(() => expect(second.useWakeLock().isActive.value).toBe(true))
  })
})

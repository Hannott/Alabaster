import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '@/utils/clipboard'

function stubSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
}

// jsdom doesn't implement `execCommand` at all, so it can't be `vi.spyOn`-ed —
// it has to be defined outright, same as any other missing browser API.
function stubExecCommand(returns: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn().mockReturnValue(returns)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
  return execCommand
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

describe('copyToClipboard', () => {
  it('uses the async Clipboard API in a secure context', async () => {
    stubSecureContext(true)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await expect(copyToClipboard('abc123')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc123')
  })

  it('falls back to execCommand outside a secure context, as on a plain-HTTP deployment', async () => {
    stubSecureContext(false)
    const execCommand = stubExecCommand(true)

    await expect(copyToClipboard('abc123')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    stubSecureContext(true)
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const execCommand = stubExecCommand(true)

    await expect(copyToClipboard('abc123')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('reports failure when execCommand is unsupported', async () => {
    stubSecureContext(false)
    stubExecCommand(false)

    await expect(copyToClipboard('abc123')).resolves.toBe(false)
  })
})

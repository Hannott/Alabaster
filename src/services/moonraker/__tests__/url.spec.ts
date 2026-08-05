import { describe, expect, it } from 'vitest'

import {
  defaultMoonrakerWebSocketUrl,
  moonrakerGcodeFileUrl,
  moonrakerFileUrl,
  moonrakerHttpBaseUrl,
  moonrakerThumbnailUrl,
  MoonrakerEndpointError,
  normalizeMoonrakerWebSocketUrl,
} from '@/services/moonraker'

describe('Moonraker WebSocket URL normalization', () => {
  it.each([
    ['printer.local:7125', 'ws://printer.local:7125/websocket'],
    ['http://printer.local:7125', 'ws://printer.local:7125/websocket'],
    ['https://printer.local/moonraker', 'wss://printer.local/moonraker/websocket'],
    ['wss://printer.local/websocket', 'wss://printer.local/websocket'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeMoonrakerWebSocketUrl(input, 'http://alabaster.local/')).toBe(expected)
  })

  it('uses the current origin for an empty endpoint', () => {
    expect(defaultMoonrakerWebSocketUrl('https://alabaster.local/#/settings')).toBe(
      'wss://alabaster.local/websocket',
    )
  })

  it('rejects unsupported schemes and embedded credentials', () => {
    expect(() => normalizeMoonrakerWebSocketUrl('ftp://printer.local')).toThrow(
      MoonrakerEndpointError,
    )
    expect(() => normalizeMoonrakerWebSocketUrl('ws://user:secret@printer.local')).toThrow(
      MoonrakerEndpointError,
    )
  })

  it('derives encoded G-code download URLs from the WebSocket endpoint', () => {
    expect(moonrakerHttpBaseUrl('ws://printer.local:7125/websocket').toString()).toBe(
      'http://printer.local:7125/',
    )
    expect(
      moonrakerGcodeFileUrl(
        'gcodes/calibration/first layer å.gcode',
        'wss://printer.local/websocket',
      ),
    ).toBe('https://printer.local/server/files/gcodes/calibration/first%20layer%20%C3%A5.gcode')
  })

  it('rejects paths that could escape the G-code root', () => {
    expect(() => moonrakerGcodeFileUrl('../printer.cfg', 'ws://printer.local/websocket')).toThrow(
      MoonrakerEndpointError,
    )
  })

  it('builds encoded URLs for configuration files without escaping their root', () => {
    expect(
      moonrakerFileUrl('config', 'hardware/bed mesh.cfg', 'ws://printer.local/websocket'),
    ).toBe('http://printer.local/server/files/config/hardware/bed%20mesh.cfg')
    expect(() =>
      moonrakerFileUrl('config', 'hardware/../moonraker.conf', 'ws://printer.local/websocket'),
    ).toThrow(MoonrakerEndpointError)
  })

  it('resolves thumbnail paths against the G-code file directory, not the root', () => {
    // Moonraker reports relative_path relative to the file's own directory.
    expect(
      moonrakerThumbnailUrl(
        'parts/cube.gcode',
        '.thumbs/cube-300x300.png',
        'ws://printer.local/websocket',
      ),
    ).toBe('http://printer.local/server/files/gcodes/parts/.thumbs/cube-300x300.png')

    // A file at the root has no directory to prepend.
    expect(moonrakerThumbnailUrl('cube.gcode', './cube.png', 'ws://printer.local/websocket')).toBe(
      'http://printer.local/server/files/gcodes/cube.png',
    )

    expect(() =>
      moonrakerThumbnailUrl('parts/cube.gcode', '../escape.png', 'ws://printer.local/websocket'),
    ).toThrow(MoonrakerEndpointError)
  })
})

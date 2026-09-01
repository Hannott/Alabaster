import { describe, expect, it } from 'vitest'

import {
  cameraBoxAspectRatio,
  cameraFrameLayout,
  normalizeCamera,
  resolveCameraUrl,
  type Camera,
} from '@/features/camera/camera'
import { cameraStillFilename } from '@/features/camera/capture'
import { cameraCrosshair, crosshairColorValue } from '@/features/camera/crosshair'
import { cameraServiceIds, cameraServiceTraits, parseAspectRatio } from '@/features/camera/services'
import type { MoonrakerWebcam } from '@/services/moonraker'

const endpoint = 'ws://printer.local:7125/websocket'

function camera(overrides: Partial<MoonrakerWebcam> = {}): Camera {
  return normalizeCamera(
    {
      name: 'Chamber',
      service: 'mjpegstreamer',
      enabled: true,
      stream_url: '/webcam/?action=stream',
      snapshot_url: '/webcam/?action=snapshot',
      ...overrides,
    },
    endpoint,
  )
}

describe('camera URL resolution', () => {
  it('resolves a relative path against the printer, not the page', () => {
    expect(resolveCameraUrl('/webcam/?action=stream', endpoint)).toBe(
      'http://printer.local:7125/webcam/?action=stream',
    )
    expect(resolveCameraUrl('/camera', 'wss://printer.example/websocket')).toBe(
      'https://printer.example/camera',
    )
  })

  it('leaves an absolute URL alone, since the stream may be another host entirely', () => {
    expect(resolveCameraUrl('http://192.168.1.125:4747/video', endpoint)).toBe(
      'http://192.168.1.125:4747/video',
    )
  })

  it('keeps the stored path as stored, so editing never pins a camera to one host', () => {
    const entry = camera()
    expect(entry.rawStreamUrl).toBe('/webcam/?action=stream')
    expect(entry.streamUrl).toBe('http://printer.local:7125/webcam/?action=stream')
  })
})

describe('camera normalization', () => {
  /*
   * A Moonraker too old to send a field is not saying "zero" — it predates the
   * field — so every absent value takes the API's own documented default.
   */
  it("fills every absent field with Moonraker's own default", () => {
    const entry = camera()
    expect(entry.location).toBe('printer')
    expect(entry.targetFps).toBe(15)
    expect(entry.targetFpsIdle).toBe(5)
    expect(entry.rotation).toBe(0)
    expect(entry.aspectRatioText).toBe('4:3')
    expect(entry.flipHorizontal).toBe(false)
    expect(entry.isReadOnly).toBe(false)
  })

  it('falls back to the name when Moonraker sends no uid', () => {
    expect(camera().uid).toBe('Chamber')
    expect(camera({ uid: 'abc-123' }).uid).toBe('abc-123')
  })

  it('marks a camera from moonraker.conf read-only, since the API refuses to write it', () => {
    expect(camera({ source: 'config' }).isReadOnly).toBe(true)
    expect(camera({ source: 'database' }).isReadOnly).toBe(false)
  })

  it('rejects a rotation the API would not accept rather than passing it through', () => {
    expect(camera({ rotation: 45 }).rotation).toBe(0)
    expect(camera({ rotation: 270 }).rotation).toBe(270)
  })

  /*
   * A camera saved as adaptive with only a stream URL, or the reverse, still
   * shows a picture instead of an empty stage that reads as a broken camera.
   */
  it('falls back to the other URL when the service’s own one is empty', () => {
    expect(camera({ service: 'mjpegstreamer-adaptive', snapshot_url: '' }).primaryUrl).toBe(
      'http://printer.local:7125/webcam/?action=stream',
    )
    expect(camera({ stream_url: '' }).primaryUrl).toBe(
      'http://printer.local:7125/webcam/?action=snapshot',
    )
  })

  it('renders an unknown service rather than failing, since Moonraker accepts any string', () => {
    expect(camera({ service: 'something-new' }).service).toBe('mjpegstreamer')
  })
})

describe('camera frame geometry', () => {
  it('parses an aspect ratio and refuses to guess at a broken one', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(parseAspectRatio('4/3')).toBeCloseTo(4 / 3)
    expect(parseAspectRatio('0:9')).toBeNull()
    expect(parseAspectRatio('wide')).toBeNull()
    expect(parseAspectRatio(undefined)).toBeNull()
  })

  it('swaps the tile’s shape on a quarter turn and keeps it on a half turn', () => {
    expect(cameraBoxAspectRatio(camera({ rotation: 90 }), 16 / 9)).toBeCloseTo(9 / 16)
    expect(cameraBoxAspectRatio(camera({ rotation: 180 }), 16 / 9)).toBeCloseTo(16 / 9)
    expect(cameraBoxAspectRatio(camera(), null)).toBeCloseTo(4 / 3)
  })

  /*
   * The failure this pins: sizing the frame to the tile and rotating that
   * instead put a landscape stream in a portrait box, cropped to a strip down
   * the middle. A quarter turn has to lay the frame out transposed *first*.
   */
  it('lays a quarter-turned frame out transposed, so it lands on the tile after rotating', () => {
    const turned = cameraFrameLayout(camera({ rotation: 90 }), 2)
    expect(turned.transform).toContain('translate(-50%, -50%)')
    expect(turned.transform).toContain('rotate(90deg)')
    expect(turned.width).toBe('calc(100% * 2)')
    expect(turned.height).toBe('calc(100% / 2)')
  })

  it('leaves an unrotated frame at the tile’s own size', () => {
    const flat = cameraFrameLayout(camera({ flip_horizontal: true }), 2)
    expect(flat.width).toBeUndefined()
    expect(flat.height).toBeUndefined()
    expect(flat.transform).toBe('translate(-50%, -50%) scaleX(-1)')
  })
})

describe('camera service traits', () => {
  /*
   * The editor and the renderer both read `traits`, which is what keeps the form
   * from offering a value the renderer ignores. A service missing from the table
   * would silently take mjpegstreamer's answers.
   */
  it('answers for every service the product claims to speak', () => {
    for (const id of cameraServiceIds) {
      expect(cameraServiceTraits(id).id, id).toBe(id)
    }
  })

  it('builds adaptive MJPEG on the snapshot URL, which is why it needs one', () => {
    expect(cameraServiceTraits('mjpegstreamer-adaptive').primaryUrl).toBe('snapshot')
    expect(cameraServiceTraits('mjpegstreamer').primaryUrl).toBe('stream')
  })

  it('reports no measurable frame rate for the two services that cannot be measured', () => {
    expect(cameraServiceTraits('uv4l-mjpeg').reportsFrames).toBe(false)
    expect(cameraServiceTraits('iframe').reportsFrames).toBe(false)
    expect(cameraServiceTraits('iframe').canCaptureStill).toBe(false)
  })
})

describe('the nozzle crosshair', () => {
  /*
   * Two stored fields, one owner each: Alabaster reads its palette key so the
   * crosshair follows the theme pack, and writes the hex only so Mainsail — which
   * knows nothing about the key — still draws one.
   */
  it("prefers Alabaster's palette key over a hex from another interface", () => {
    const entry = camera({
      extra_data: {
        nozzleCrosshair: true,
        alabasterCrosshairColor: 'blue',
        nozzleCrosshairColor: '#0072b2',
      },
    })
    const crosshair = cameraCrosshair(entry)
    expect(crosshair.colorKey).toBe('blue')
    expect(crosshairColorValue(crosshair)).toBe('var(--color-data-blue)')
  })

  it("draws another interface's own hex when there is no key beside it", () => {
    const crosshair = cameraCrosshair(
      camera({ extra_data: { nozzleCrosshair: true, nozzleCrosshairColor: '#123456' } }),
    )
    expect(crosshair.colorKey).toBeNull()
    expect(crosshairColorValue(crosshair)).toBe('#123456')
  })

  it('leaves the color to the stylesheet when nothing was ever chosen', () => {
    expect(crosshairColorValue(cameraCrosshair(camera()))).toBeNull()
  })

  it('clamps a stored size into a range that can actually be drawn', () => {
    expect(cameraCrosshair(camera({ extra_data: { nozzleCrosshairSize: 9 } })).size).toBe(1)
    expect(cameraCrosshair(camera({ extra_data: { nozzleCrosshairSize: -1 } })).size).toBe(0.01)
    expect(cameraCrosshair(camera()).size).toBe(0.1)
  })
})

describe('still capture filenames', () => {
  it('sorts chronologically and survives a filesystem that rejects colons', () => {
    const name = cameraStillFilename(
      camera({ name: 'Chamber cam #2' }),
      new Date(1_700_000_000_000),
    )
    expect(name).toMatch(/^Chamber-cam-2-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.jpg$/)
    expect(name).not.toContain(':')
  })

  it('still produces a filename for a camera whose name is all punctuation', () => {
    expect(cameraStillFilename(camera({ name: '///' }), new Date(0))).toMatch(/^camera-/)
  })
})

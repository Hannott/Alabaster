import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/locales/en.json'
import nb from '@/locales/nb.json'
import { cameraServiceIds, cameraServiceList } from '@/features/camera/services'

const sourceRoot = join(process.cwd(), 'src')
const streamerDir = join(sourceRoot, 'components', 'camera', 'streamers')
const streamerSource = readFileSync(join(streamerDir, 'streamer.ts'), 'utf8')

/*
 * The service identifiers are Moonraker's, shared with every other Klipper
 * interface on the printer, and each one needs three things to work: a renderer,
 * a name in every language, and a traits entry. Miss any one and the failure is
 * quiet — a camera that renders nothing, a picker row reading
 * `cameras.services.foo`, or a form offering a field the renderer ignores.
 */
describe('camera services', () => {
  it('has a renderer for every service, and a file behind it', () => {
    for (const id of cameraServiceIds) {
      // `s` so the key and its import may sit on separate lines; the longer
      // entries are wrapped by the formatter.
      const match = streamerSource.match(
        new RegExp(`'?${id.replace(/-/g, '\\-')}'?:.*?import\\('\\./(\\w+)\\.vue'\\)`, 's'),
      )
      expect(match, `${id} has no streamer import`).not.toBeNull()
      const file = join(streamerDir, `${match?.[1]}.vue`)
      expect(existsSync(file), `${id} points at a missing ${match?.[1]}.vue`).toBe(true)
    }
  })

  it('names every service in every language', () => {
    const catalogs: Record<string, { cameras: { services: Record<string, string> } }> = {
      en: en as never,
      nb: nb as never,
    }
    for (const traits of cameraServiceList) {
      const key = traits.labelKey.replace('cameras.services.', '')
      for (const [locale, catalog] of Object.entries(catalogs)) {
        expect(typeof catalog.cameras.services[key], `${traits.id} in ${locale}`).toBe('string')
      }
    }
  })

  /*
   * Each streamer is behind its own dynamic import so a printer with one MJPEG
   * camera never downloads the WebRTC handshakes, the HLS library, or the H.264
   * remuxer. A static import of any of them would undo that for everyone.
   */
  it('loads every streamer on demand rather than up front', () => {
    expect(streamerSource).not.toMatch(/^import \w+ from '\.\/\w+Streamer\.vue'/m)
    expect(streamerSource.match(/import\('\.\/\w+\.vue'\)/g)?.length).toBe(cameraServiceIds.length)
  })
})

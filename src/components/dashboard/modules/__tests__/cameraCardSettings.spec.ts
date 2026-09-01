import { describe, expect, it } from 'vitest'

import {
  cameraCardSettings,
  camerasOnOtherCards,
  firstUnclaimedCamera,
  selectedCameras,
} from '@/components/dashboard/modules/cameraCardSettings'
import type { DashboardModuleInstance } from '@/dashboard/layout'
import { normalizeCamera, type Camera } from '@/features/camera/camera'

function camera(uid: string, enabled = true): Camera {
  return normalizeCamera(
    {
      uid,
      name: uid,
      service: 'mjpegstreamer',
      enabled,
      stream_url: `/webcam/${uid}?action=stream`,
      snapshot_url: '',
    },
    'ws://printer.local:7125/websocket',
  )
}

function instance(instanceId: string, cameras: unknown): DashboardModuleInstance {
  return { instanceId, moduleId: 'camera', title: null, config: { cameras } }
}

describe('Camera card settings', () => {
  it('reads its defaults from an empty configuration', () => {
    const settings = cameraCardSettings({})
    expect(settings.cameraUids).toBeNull()
    expect(settings.arrangement).toBe('grid')
    expect(settings.stacking).toBe('horizontal')
    expect(settings.columns).toBe(2)
    expect(settings.showLabels).toBe(true)
  })

  it('clamps a hand-edited column count into what the grid can draw', () => {
    expect(cameraCardSettings({ columns: 0 }).columns).toBe(1)
    expect(cameraCardSettings({ columns: 99 }).columns).toBe(4)
    expect(cameraCardSettings({ columns: 'three' }).columns).toBe(2)
  })

  it('falls back to side by side for a stacking value it does not recognize', () => {
    expect(cameraCardSettings({ stacking: 'vertical' }).stacking).toBe('vertical')
    expect(cameraCardSettings({ stacking: 'diagonal' }).stacking).toBe('horizontal')
    expect(cameraCardSettings({ stacking: 3 }).stacking).toBe('horizontal')
  })

  /*
   * The whole point of storing `null` separately from `[]`. A card nobody has
   * configured adopts a camera; a card whose cameras were removed on purpose
   * stays empty. Collapsing the two either left an emptied card showing a stream
   * its owner had just removed, or left a new card blank.
   */
  it('tells a never-configured card apart from one deliberately emptied', () => {
    expect(cameraCardSettings({}).cameraUids).toBeNull()
    expect(cameraCardSettings({ cameras: [] }).cameraUids).toEqual([])
  })

  it('renders nothing for either, leaving the adoption to the module', () => {
    const available = [camera('a')]
    expect(selectedCameras(cameraCardSettings({}), available)).toEqual([])
    expect(selectedCameras(cameraCardSettings({ cameras: [] }), available)).toEqual([])
  })

  it('shows the named cameras in the order named', () => {
    const available = [camera('a'), camera('b'), camera('c')]
    const shown = selectedCameras(cameraCardSettings({ cameras: ['c', 'a'] }), available)
    expect(shown.map((entry) => entry.uid)).toEqual(['c', 'a'])
  })

  it('drops a camera the printer no longer has, rather than tiling a black box', () => {
    const shown = selectedCameras(cameraCardSettings({ cameras: ['gone', 'a'] }), [camera('a')])
    expect(shown.map((entry) => entry.uid)).toEqual(['a'])
  })

  it('honors the enabled switch, whose whole job is to stop a camera streaming', () => {
    const shown = selectedCameras(cameraCardSettings({ cameras: ['a'] }), [camera('a', false)])
    expect(shown).toEqual([])
  })
})

describe('claiming cameras across cards', () => {
  /*
   * Two cards streaming one camera costs the printer twice for the same picture
   * and makes the cards indistinguishable — so a camera on another card is not
   * offered again, and a new card takes the first one left.
   */
  it('collects what every other Camera card is showing', () => {
    const instances = [
      instance('camera', ['a']),
      instance('camera-2', ['b', 'c']),
      { instanceId: 'macros', moduleId: 'macros' as const, title: null, config: {} },
    ]
    expect([...camerasOnOtherCards(instances, 'camera')].sort()).toEqual(['b', 'c'])
    expect([...camerasOnOtherCards(instances, 'camera-2')]).toEqual(['a'])
  })

  it('ignores a card that has never been configured, which claims nothing yet', () => {
    expect(camerasOnOtherCards([instance('camera-2', undefined)], 'camera').size).toBe(0)
  })

  it('adopts the first camera nobody else has taken', () => {
    const available = [camera('a'), camera('b'), camera('c')]
    expect(firstUnclaimedCamera(available, new Set(['a']))?.uid).toBe('b')
    expect(firstUnclaimedCamera(available, new Set(['a', 'b', 'c']))).toBeNull()
  })

  it('never adopts a switched-off camera, which would render as an empty card', () => {
    expect(firstUnclaimedCamera([camera('a', false), camera('b')], new Set())?.uid).toBe('b')
  })
})

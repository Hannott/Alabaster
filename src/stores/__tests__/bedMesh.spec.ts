import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObjectSnapshotHandler } from '@/services/moonraker'
import { normalizeMatrix, useBedMeshStore } from '@/stores/bedMesh'
import { useMoonrakerStore } from '@/stores/moonraker'

describe('mesh matrix normalization', () => {
  it('accepts a rectangular matrix and rejects a ragged one', () => {
    expect(
      normalizeMatrix([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    ).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    expect(normalizeMatrix([[0.1, 0.2], [0.3]])).toEqual([])
    expect(normalizeMatrix('nonsense')).toEqual([])
  })
})

describe('bed mesh store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('summarizes the probed mesh and lists loadable profiles', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    snapshotHandler?.({
      eventtime: 1,
      status: {
        bed_mesh: {
          profile_name: 'default',
          mesh_min: [20, 20],
          mesh_max: [280, 280],
          probed_matrix: [
            [0.05, 0.1],
            [-0.02, 0.16],
          ],
          profiles: { default: {}, cold: {} },
        },
      },
    })

    expect(bedMesh.isActive).toBe(true)
    expect(bedMesh.profiles).toEqual(['cold', 'default'])
    expect(bedMesh.columnCount).toBe(2)
    expect(bedMesh.cells).toHaveLength(4)
    expect(bedMesh.lowest).toBe(-0.02)
    expect(bedMesh.highest).toBe(0.16)
    expect(bedMesh.range).toBeCloseTo(0.18, 5)
  })

  it('draws the mesh Klipper interpolated, and falls back to the probed points', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    const probed = [
      [0.05, 0.1],
      [-0.02, 0.16],
    ]
    snapshotHandler?.({
      eventtime: 1,
      status: { bed_mesh: { profile_name: 'default', probed_matrix: probed } },
    })
    // A profile carrying no interpolation still has to draw something.
    expect(bedMesh.surfaceMatrix).toEqual(probed)

    const interpolated = [
      [0.05, 0.07, 0.1],
      [0.02, 0.08, 0.13],
      [-0.02, 0.07, 0.16],
    ]
    snapshotHandler?.({ eventtime: 2, status: { bed_mesh: { mesh_matrix: interpolated } } })
    expect(bedMesh.surfaceMatrix).toEqual(interpolated)
    // The reported figures stay the measurements, never the interpolation.
    expect(bedMesh.lowest).toBe(-0.02)
    expect(bedMesh.highest).toBe(0.16)
  })

  it('takes the bed shape from the probed bounds rather than the grid shape', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    expect(bedMesh.aspect).toBe(1)

    snapshotHandler?.({
      eventtime: 1,
      status: {
        bed_mesh: {
          profile_name: 'default',
          mesh_min: [10, 10],
          mesh_max: [260, 210],
          // Five columns over 250 mm and three rows over 200 mm: the grid is
          // wider than the bed is, so the shape cannot come from its shape.
          probed_matrix: [
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
          ],
        },
      },
    })

    expect(bedMesh.aspect).toBeCloseTo(250 / 200, 6)
  })

  it('reports no active mesh once the profile is cleared', () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const bedMesh = useBedMeshStore()
    bedMesh.start()
    snapshotHandler?.({
      eventtime: 1,
      status: { bed_mesh: { profile_name: 'default', probed_matrix: [[0.1]] } },
    })
    expect(bedMesh.isActive).toBe(true)

    snapshotHandler?.({
      eventtime: 2,
      status: { bed_mesh: { profile_name: '', probed_matrix: [] } },
    })

    expect(bedMesh.isActive).toBe(false)
    expect(bedMesh.range).toBeNull()
  })

  it('has no recorded probe temperature for a profile it never calibrated', () => {
    const bedMesh = useBedMeshStore()
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })

  it('commits a fresh calibration to the name it is saved under', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.recordCalibration(52.3)
    bedMesh.commitProfileTemperature('', 'garage-cold')

    bedMesh.profileName = 'garage-cold'
    expect(bedMesh.activeProbeTemperature).toBe(52.3)
  })

  it('falls back to the source profile when saving under a new name with nothing pending', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.recordCalibration(48)
    bedMesh.commitProfileTemperature('', 'original')
    // Saving a copy under a new name with no fresh calibration pending.
    bedMesh.commitProfileTemperature('original', 'copy')

    bedMesh.profileName = 'copy'
    expect(bedMesh.activeProbeTemperature).toBe(48)
  })

  it('records nothing when neither a pending calibration nor a source temperature exists', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.commitProfileTemperature('', 'mystery')

    bedMesh.profileName = 'mystery'
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })

  it('carries a temperature through a rename and drops the old entry', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.recordCalibration(60)
    bedMesh.commitProfileTemperature('', 'old-name')
    bedMesh.commitProfileTemperature('old-name', 'new-name')
    bedMesh.dropProfileTemperature('old-name')

    bedMesh.profileName = 'new-name'
    expect(bedMesh.activeProbeTemperature).toBe(60)

    bedMesh.profileName = 'old-name'
    expect(bedMesh.activeProbeTemperature).toBeNull()
  })

  it('suggests the loaded profile name when saving under it would replace nothing', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.profileName = 'garage'
    bedMesh.profiles = ['default']
    expect(bedMesh.suggestedProfileName).toBe('garage')
  })

  it('suggests a numbered variant of "default" once a saved default already exists', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.profileName = 'default'
    bedMesh.profiles = ['default']
    expect(bedMesh.suggestedProfileName).toBe('default2')

    bedMesh.profiles = ['default', 'default2']
    expect(bedMesh.suggestedProfileName).toBe('default3')
  })

  it('suggests "default" itself when nothing is loaded and no default is saved', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.profileName = ''
    bedMesh.profiles = ['garage']
    expect(bedMesh.suggestedProfileName).toBe('default')
  })

  it('persists recorded temperatures across a fresh store instance', () => {
    const bedMesh = useBedMeshStore()
    bedMesh.recordCalibration(55.5)
    bedMesh.commitProfileTemperature('', 'saved-across-reload')

    setActivePinia(createPinia())
    const reloaded = useBedMeshStore()
    reloaded.profileName = 'saved-across-reload'
    expect(reloaded.activeProbeTemperature).toBe(55.5)
  })
})

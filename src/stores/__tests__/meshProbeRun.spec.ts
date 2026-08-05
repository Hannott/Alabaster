import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { usePrinterStore } from '@/stores/printer'

/** Appends console lines the way the console store's transcript grows. */
async function say(...lines: string[]): Promise<void> {
  const gcodeConsole = useConsoleStore()
  for (const raw of lines) {
    gcodeConsole.consoleEntries = [
      ...gcodeConsole.consoleEntries,
      { id: raw + gcodeConsole.consoleEntries.length, raw, kind: 'response', at: 0 },
    ] as never
  }
  await nextTick()
}

const firstPoint = 'probe: at 10.000,10.000 bed will contact at z=1.000000'
const secondPoint = 'probe: at 50.000,10.000 bed will contact at z=1.040000'

describe('mesh probe run store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    useConsoleStore().consoleEntries = [] as never
  })

  it('follows nothing until a calibration is asked for', async () => {
    const run = useMeshProbeRunStore()

    await say(firstPoint)

    // A probe line outside a mesh run belongs to QGL, Z-tilt, or a manual PROBE.
    expect(run.isRunning).toBe(false)
    expect(run.points).toEqual([])
  })

  it('collects each point as it is probed', async () => {
    const run = useMeshProbeRunStore()

    await say('BED_MESH_CALIBRATE')
    expect(run.isRunning).toBe(true)

    await say(firstPoint, secondPoint)

    expect(run.points).toEqual([
      { x: 10, y: 10, z: 1 },
      { x: 50, y: 10, z: 1.04 },
    ])
  })

  it('ignores the chatter between points', async () => {
    const run = useMeshProbeRunStore()

    await say('BED_MESH_CALIBRATE', firstPoint)
    await say('Klipper state: Ready', 'probe: open', 'B:60.0 /60.0')

    expect(run.points).toHaveLength(1)
  })

  /**
   * The bug this guards: the run used to be accumulated as lines arrived and
   * cleared when the page unmounted, so navigating away mid-calibration and back
   * lost the run entirely and left the viewer with nothing to draw. The printer
   * keeps probing whether or not anything is watching, so the state has to be a
   * function of what it has said.
   */
  it('still follows a run after the page that was watching goes away and returns', async () => {
    const first = useMeshProbeRunStore()
    await say('BED_MESH_CALIBRATE', firstPoint)
    expect(first.points).toHaveLength(1)

    // Whatever a page does on unmount, the run is still the printer's.
    const returned = useMeshProbeRunStore()
    await say(secondPoint)

    expect(returned.isRunning).toBe(true)
    expect(returned.points).toHaveLength(2)
  })

  /**
   * The finished mesh is the one trustworthy end signal — Klipper prints no
   * completion line worth relying on and Kalico's differs — so the watch that
   * sees it lives for the store's lifetime, not a page's. A run finishing while
   * nobody is looking still has to stop being followed.
   */
  it('hands over to the finished mesh even if it lands while unwatched', async () => {
    const run = useMeshProbeRunStore()
    const bedMesh = useBedMeshStore()

    await say('BED_MESH_CALIBRATE', firstPoint)
    expect(run.hasPoints).toBe(true)

    bedMesh.probedMatrix = [[1, 1.04]]
    await nextTick()

    expect(run.isRunning).toBe(false)
    expect(run.points).toEqual([])
  })

  /**
   * The defect this guards, and it is the one that made the map read "no mesh
   * loaded" for a whole calibration: `probedMatrix` is rebuilt from every
   * `bed_mesh` status push, so the array's identity changes constantly while its
   * values do not. A watch that trusted the ref ended the run on the first push
   * after it started.
   */
  it('keeps following when the mesh ref is replaced with the same values', async () => {
    const run = useMeshProbeRunStore()
    const bedMesh = useBedMeshStore()
    bedMesh.probedMatrix = [[0.1, 0.2]]
    await nextTick()

    await say('BED_MESH_CALIBRATE', firstPoint)
    expect(run.isRunning).toBe(true)

    // A fresh array with identical contents, as every status update produces.
    bedMesh.probedMatrix = [[0.1, 0.2]]
    await nextTick()

    expect(run.isRunning).toBe(true)
    expect(run.points).toHaveLength(1)
  })

  /**
   * Klipper clears the mesh as a calibration begins, so an empty matrix means the
   * run is under way — not that it is over.
   */
  it('treats the mesh being cleared as the run starting, not ending', async () => {
    const run = useMeshProbeRunStore()
    const bedMesh = useBedMeshStore()
    bedMesh.probedMatrix = [[0.1, 0.2]]
    await nextTick()

    await say('BED_MESH_CALIBRATE')
    bedMesh.probedMatrix = []
    await nextTick()
    await say(firstPoint, secondPoint)

    expect(run.isRunning).toBe(true)
    expect(run.points).toHaveLength(2)

    // And the mesh that lands at the end still finishes it.
    bedMesh.probedMatrix = [[1, 1.04]]
    await nextTick()
    expect(run.isRunning).toBe(false)
  })

  it('follows the next run after one has finished', async () => {
    const run = useMeshProbeRunStore()
    const bedMesh = useBedMeshStore()

    await say('BED_MESH_CALIBRATE', firstPoint)
    bedMesh.probedMatrix = [[1]]
    await nextTick()
    expect(run.isRunning).toBe(false)

    await say('BED_MESH_CALIBRATE PROFILE="textured"')

    expect(run.isRunning).toBe(true)
    expect(run.points).toEqual([])
  })

  it('reads the newest run, not an older one still in the transcript', async () => {
    const run = useMeshProbeRunStore()

    await say('BED_MESH_CALIBRATE', firstPoint)
    await say('BED_MESH_CALIBRATE', secondPoint)

    expect(run.points).toEqual([{ x: 50, y: 10, z: 1.04 }])
  })

  it('places the probe by its offset, not by the nozzle', async () => {
    const printerConfig = await import('@/stores/printerConfig')
    vi.spyOn(printerConfig.usePrinterConfigStore(), 'probeOffset', 'get').mockReturnValue({
      x: -24,
      y: -14,
    })
    vi.spyOn(usePrinterStore(), 'toolheadPosition', 'get').mockReturnValue([100, 100, 5])
    const run = useMeshProbeRunStore()

    expect(run.probePosition).toBeNull()

    await say('BED_MESH_CALIBRATE')

    expect(run.probePosition).toEqual({ x: 76, y: 86 })
  })
})

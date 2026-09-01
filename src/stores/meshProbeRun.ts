import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  isMeshCalibrateCommand,
  isScanningProbe,
  parseProbedPoint,
  probeBedPosition,
  type ProbedPoint,
} from '@/features/bedMesh/probeRun'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

/**
 * Follows a bed mesh calibration while it runs, so the map fills in as the
 * printer probes instead of appearing all at once when it finishes.
 *
 * Every point comes from the console, for the reason `features/bedMesh/probeRun`
 * explains: the structured fields that look right are not updated by the mesh
 * probe path. This store reads the transcript the console store already keeps
 * rather than opening a subscription of its own.
 *
 * **The run is derived, not accumulated.** The first version collected points as
 * lines arrived and cleared them when the page unmounted, which broke the moment
 * anyone navigated: the printer keeps probing whether or not a page is watching,
 * so leaving and coming back lost the run and left the viewer with nothing to
 * draw. Reading the transcript on demand means the state is a function of what
 * the printer has said, which no amount of navigating can desynchronize.
 *
 * Points are held as a flat list positioned by their own coordinates, never as a
 * grid indexed by arrival order. Adaptive meshing and faulty regions both change
 * the point set at runtime, so assuming a shape would misplace points on exactly
 * the machines that need this most.
 */

export const useMeshProbeRunStore = defineStore('meshProbeRun', () => {
  const gcodeConsole = useConsoleStore()
  const printer = usePrinterStore()
  const printerConfig = usePrinterConfigStore()
  const bedMesh = useBedMeshStore()

  /**
   * The transcript line that started the run whose mesh has already arrived.
   * Kept so a finished run stops being followed without having to find a
   * completion line — Klipper prints none worth relying on, and Kalico's differs.
   */
  const completedRunCommand = ref<string | null>(null)

  /**
   * True when the machine's probe sweeps rather than touching each point, so the
   * page can say why there is nothing to follow instead of showing an empty map.
   */
  const isScanning = computed(() => isScanningProbe((section) => printerConfig.hasSection(section)))

  /** Index of the most recent calibrate command in the transcript, or -1. */
  const runStartIndex = computed(() => {
    const lines = gcodeConsole.consoleLines
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (isMeshCalibrateCommand(lines[index]!)) return index
    }
    return -1
  })

  /** The command line that started the current run, which identifies it. */
  const runCommand = computed(() => {
    const index = runStartIndex.value
    if (index < 0) return null
    // The index alone would shift as the transcript is trimmed; the line plus its
    // position is stable enough to tell one run from the next.
    return `${index}:${gcodeConsole.consoleLines[index]}`
  })

  const isRunning = computed(
    () => runCommand.value !== null && runCommand.value !== completedRunCommand.value,
  )

  const points = computed<ProbedPoint[]>(() => {
    if (!isRunning.value) return []
    const collected: ProbedPoint[] = []
    for (const line of gcodeConsole.consoleLines.slice(runStartIndex.value + 1)) {
      const point = parseProbedPoint(line)
      if (point) collected.push(point)
    }
    return collected
  })

  const hasPoints = computed(() => points.value.length > 0)

  /** Where the probe tip currently is in bed millimetres, for the moving marker. */
  const probePosition = computed(() =>
    isRunning.value ? probeBedPosition(printer.toolheadPosition, printerConfig.probeOffset) : null,
  )

  /** The mesh's values as text, so a run ends on new content and not on a new array. */
  function matrixSignature(): string {
    return bedMesh.probedMatrix.map((row) => row.join(',')).join(';')
  }

  /** The mesh that was loaded when the current run began. */
  const signatureAtRunStart = ref(matrixSignature())

  watch(runCommand, () => {
    signatureAtRunStart.value = matrixSignature()
  })

  /**
   * The finished mesh is the one trustworthy end signal, so this watch lives for
   * the store's lifetime rather than a page's: a run completing while nobody is
   * looking still has to stop being followed.
   *
   * It compares content rather than reacting to the ref changing, and that is the
   * whole difficulty. `probedMatrix` is rebuilt from every `bed_mesh` status push,
   * so the array identity changes constantly while the values do not — and
   * Klipper *clears* the mesh as a calibration starts, which is one such push. A
   * watch that trusted the ref therefore ended the run on the very update that
   * announced it, leaving the map on "no mesh loaded" for the whole calibration.
   *
   * An empty matrix is that clearing and means the run is under way, not over.
   * Only a non-empty mesh whose values differ from the one the run started with
   * is the finished article.
   */
  watch(
    () => matrixSignature(),
    (signature) => {
      if (!isRunning.value) return
      if (signature === '' || signature === signatureAtRunStart.value) return
      completedRunCommand.value = runCommand.value
    },
  )

  return {
    points,
    hasPoints,
    isRunning,
    isScanning,
    probePosition,
  }
})

import { computed, ref, type Ref } from 'vue'

import type { BedPoint } from '@/features/calibration/bedContext'
import {
  isReachable,
  nearestIndex,
  nearestReachable,
  pointText,
  screwCoordinate,
  screwOnBed,
  standingOver,
  type Reference,
  type ScrewTarget,
} from '@/features/calibration/toolheadPoints'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * A screw in the list being recorded: either the file's own coordinate, not
 * touched yet, or where the toolhead stood and which part of it was over the
 * screw. The part is the screw's own, fixed when it was recorded — a nozzle tip
 * is easy to sight over one screw and an eddy coil over another, and changing
 * the choice for the next screw must not move the ones already recorded.
 */
export type ScrewSource =
  | { kind: 'file'; coordinate: BedPoint }
  | { kind: 'stood'; toolhead: BedPoint; reference: Reference }

export interface ScrewEntry {
  name: string
  source: ScrewSource
}

/*
 * Module-level so the screw-positions panel, which records, and the bed
 * drawing in the live column, which draws and moves to the same list, read one
 * list. In memory only: it is a recording in progress, and the file is what
 * survives a reload.
 */
const entries = ref<ScrewEntry[]>([])
const entriesTarget = ref<ScrewTarget | null>(null)
const chosenReference = ref<Reference | null>(null)
/** Whether the list has been changed since it was read from the file. */
const touched = ref(false)

/** Back to nothing recorded; for tests, which share this module's state. */
export function resetScrewRecording(): void {
  entries.value = []
  entriesTarget.value = null
  chosenReference.value = null
  touched.value = false
}

export interface RecordingScrew {
  key: string
  /** The name typed, or empty. */
  name: string
  /** What the section will be written with, clamped into the travel. */
  coordinate: BedPoint
  /** Where the screw is on the bed. */
  onBed: BedPoint
  reachable: boolean
  /** The part stood over the screw, or null for a screw read from the file. */
  reference: Reference | null
}

export function useScrewRecording(target: Ref<ScrewTarget>) {
  const printer = usePrinterStore()
  const printerConfig = usePrinterConfigStore()

  const offset = computed(() =>
    printerConfig.hasProbe ? printerConfig.probeOffset : { x: 0, y: 0 },
  )

  /** What the next screw is recorded with, and what the drawing sends over a screw. */
  const reference = computed<Reference>({
    get: () => (printerConfig.hasProbe ? (chosenReference.value ?? 'probe') : 'nozzle'),
    set: (value) => {
      chosenReference.value = value
    },
  })

  const isFor = computed(() => entriesTarget.value === target.value)

  const screws = computed<RecordingScrew[]>(() => {
    if (!isFor.value) return []
    const travel = printer.buildVolume
    return entries.value.map((entry, index) => {
      const source = entry.source
      const wanted =
        source.kind === 'file'
          ? source.coordinate
          : screwCoordinate(target.value, source.reference, source.toolhead, offset.value)
      const reachable = isReachable(wanted, travel)
      const coordinate = reachable ? wanted : nearestReachable(wanted, travel)
      return {
        key: `screw${index + 1}`,
        name: entry.name,
        coordinate,
        onBed: screwOnBed(target.value, coordinate, offset.value),
        reachable,
        reference: source.kind === 'stood' ? source.reference : null,
      }
    })
  })

  const toolhead = computed<BedPoint | null>(() => {
    const homed = printer.motion.homedAxes.toLowerCase()
    if (!homed.includes('x') || !homed.includes('y')) return null
    const [x, y] = printer.motion.position
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
  })

  /** The screw the chosen part is closest to now, which a re-record replaces. */
  const nearest = computed<number | null>(() =>
    toolhead.value === null
      ? null
      : nearestIndex(
          screws.value.map((screw) => screw.onBed),
          standingOver(reference.value, toolhead.value, offset.value),
        ),
  )

  function stoodHere(): ScrewSource | null {
    if (toolhead.value === null) return null
    return { kind: 'stood', toolhead: toolhead.value, reference: reference.value }
  }

  /** Replaces the list with the file's screws, names as the file writes them. */
  function seed(coordinates: readonly BedPoint[], written: Record<string, unknown> | null): void {
    entriesTarget.value = target.value
    touched.value = false
    entries.value = coordinates.map((coordinate, index) => {
      const name = written?.[`screw${index + 1}_name`]
      return { name: typeof name === 'string' ? name : '', source: { kind: 'file', coordinate } }
    })
  }

  function change(next: ScrewEntry[]): void {
    entries.value = next
    touched.value = true
  }

  function record(name: string): void {
    const source = stoodHere()
    if (source === null) return
    change([...entries.value, { name, source }])
  }

  function rerecordNearest(): void {
    const source = stoodHere()
    const index = nearest.value
    if (source === null || index === null) return
    change(
      entries.value.map((entry, position) => (position === index ? { ...entry, source } : entry)),
    )
  }

  function rename(index: number, name: string): void {
    change(
      entries.value.map((entry, position) => (position === index ? { ...entry, name } : entry)),
    )
  }

  function remove(index: number): void {
    change(entries.value.filter((_, position) => position !== index))
  }

  function clear(): void {
    change([])
  }

  /** Lets the next read of the file replace the list, once what it holds has been written. */
  function settle(): void {
    touched.value = false
  }

  /** Whether writing the list would change the file: a coordinate, a name, or the count. */
  function differsFrom(
    configured: readonly BedPoint[],
    written: Record<string, unknown> | null,
  ): boolean {
    if (screws.value.length !== configured.length) return true
    return screws.value.some((screw, index) => {
      const before = configured[index]
      if (!before || pointText(before) !== pointText(screw.coordinate)) return true
      const name = written?.[`screw${index + 1}_name`]
      return screw.name.trim() !== (typeof name === 'string' ? name.trim() : '')
    })
  }

  return {
    entries,
    isFor,
    touched,
    offset,
    reference,
    screws,
    toolhead,
    nearest,
    seed,
    record,
    rerecordNearest,
    rename,
    remove,
    clear,
    settle,
    differsFrom,
  }
}

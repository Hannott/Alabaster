import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'

import type {
  JsonRpcNotification,
  ObjectSnapshotHandler,
  PrinterObjectSelection,
  PrinterObjectSnapshot,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import {
  applyRecording,
  emptyCurve,
  emptyRecorderState,
  estimateSeconds,
  fingerprintFor,
  recordObservation,
  type HeatCurve,
  type HeatRecorderState,
} from '@/stores/heatModel'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { isRecord } from '@/utils/records'

const telemetrySubscriptionKey = 'alabaster.telemetry'
/**
 * One point a second across the widest chart window the Temperatures module
 * offers, which is twenty minutes — the same span `server.temperature_store`
 * backfills from by default, so a reload's seeded history and a full live
 * buffer agree on how much the widest window can ever show.
 *
 * This constant used to claim it was sized "rather than against an assumed
 * interval", and it had assumed one: Moonraker pushes roughly four times a
 * second, measured at 251 ms on a real machine, so a naive point-per-push cap
 * covered a fraction of the window's duration in points rather than seconds.
 * The cap alone cannot fix that — a cap is a count and a window is a duration
 * — so the append below is what holds the rate, and the two have to be read
 * together.
 *
 * One more than the window's seconds, because N points fence N−1 intervals: at
 * 1200 the oldest reading sits a second inside the twenty-minute window and the
 * left edge of the chart is never quite reached.
 */
const maximumHistoryPoints = 1201
/**
 * The chart wants a point a second; the feed delivers four. Anything finer is
 * invisible in a plot a few hundred pixels wide and would be thrown away by
 * downsampling before it was drawn. Consumers that genuinely need every sample
 * — the heat model measuring how long a band took to cross — read the merge
 * stream directly rather than this history.
 */
const historyIntervalSeconds = 1
/**
 * Moonraker's own data store samples once a second. Its arrays carry no
 * timestamps, so this is what dates them — and it is the same cadence the
 * append above holds to, which is why a seeded point and a live one sit on the
 * same rhythm rather than interleaving at odd spacings.
 */
const moonrakerStoreIntervalSeconds = 1
/** The window a rate-of-change or time-to-target estimate is fit against. */
const rateWindowSeconds = 30
/** Below this magnitude a fitted slope is noise, not a trend. */
const rateNoiseFloorPerMinute = 0.6
/** A target is treated as reached once within this many degrees. */
const targetSettleMargin = 0.5
/** How long a heater must fail to gain before it is called stalled. */
const stallWindowSeconds = 45
/** Minimum history span required before a stall verdict is trusted at all. */
const stallMinimumSpanSeconds = 40
/** A heater within this many degrees of its target is "close enough", not stalled. */
const stallSettleMargin = 2
/** How long a heater is left alone after a new target before it can be judged. */
const stallGraceSeconds = 5
/** Total gain below this over the stall window counts as "not climbing". */
const stallEpsilon = 1
/**
 * Where the learned heat curves live, keyed by Moonraker endpoint the same way
 * the dashboard scopes its profiles: one browser may watch several printers,
 * and a curve measured on one says nothing about another.
 */
const heatCurveStorageKey = 'alabaster.telemetry.heatCurves.v1'
/**
 * Calibrations kept per heater before the least recently written is dropped.
 * Enough that reverting a calibration finds its measurements still there,
 * bounded so repeated recalibration cannot grow this without limit.
 */
const maximumStoredFingerprints = 4
/** Writes are batched: a band completes far more often than a user reloads. */
const curvePersistDelayMilliseconds = 2000

export type SensorKind = 'extruder' | 'bed' | 'heater' | 'sensor' | 'temperatureFan'

export interface SensorReading {
  objectName: string
  name: string
  kind: SensorKind
  temperature: number | null
  target: number | null
  power: number | null
  speed: number | null
  isSettable: boolean
}

/** Learned curves for one printer: heater, then the calibration it was measured under. */
export type StoredHeatCurves = Record<string, Record<string, HeatCurve>>

export interface FanReading {
  objectName: string
  speed: number | null
  rpm: number | null
}

export interface TemperatureTelemetry {
  temperature: number | null
  target: number | null
}

export interface TemperatureHistoryPoint {
  eventtime: number
  values: Record<string, number | null>
  /** Optional so a fixture, or history recorded before these existed, still reads. */
  targets?: Record<string, number | null>
  powers?: Record<string, number | null>
}

/** Which recorded quantity `pointsWithin` should read. */
export type HistoryField = 'values' | 'targets' | 'powers'

const sensorObjectPrefixes = ['heater_generic ', 'temperature_sensor ', 'temperature_fan '] as const
const fanObjectPrefixes = ['fan_generic ', 'heater_fan ', 'controller_fan '] as const
const outputPinPrefix = 'output_pin '

export function isFanObject(objectName: string): boolean {
  return objectName === 'fan' || fanObjectPrefixes.some((prefix) => objectName.startsWith(prefix))
}

export function isOutputPinObject(objectName: string): boolean {
  return objectName.startsWith(outputPinPrefix)
}

interface TimedValue {
  eventtime: number
  value: number
}

/**
 * Points for one sensor within `windowSeconds` of the history's own latest
 * `eventtime` — never a slice by array position, since Klipper's push cadence
 * is not guaranteed and a slower feed would otherwise cover a shorter span
 * than the caller asked for.
 *
 * `bleedBefore` keeps that many samples older than the floor as well. A rate
 * or stall calculation wants exactly its window and no more, so it stays at
 * the default of none. The chart asks for a few, so the line it draws starts
 * outside the plot's clipped edge rather than somewhere inside it — see
 * `chartBleedSamples` in `TemperaturesModule.vue` for how many that has to be
 * and why the floor alone is not far enough back.
 */
export function pointsWithin(
  history: readonly TemperatureHistoryPoint[],
  objectName: string,
  windowSeconds: number,
  field: HistoryField = 'values',
  bleedBefore = 0,
): TimedValue[] {
  const latestPoint = history[history.length - 1]
  if (!latestPoint) return []
  const floor = latestPoint.eventtime - windowSeconds

  let firstInWindow = history.length
  for (let index = 0; index < history.length; index += 1) {
    if (history[index]!.eventtime >= floor) {
      firstInWindow = index
      break
    }
  }
  const startIndex = Math.max(0, firstInWindow - bleedBefore)

  const points: TimedValue[] = []
  for (let index = startIndex; index < history.length; index += 1) {
    const point = history[index]!
    const value = point[field]?.[objectName]
    if (value !== null && value !== undefined) points.push({ eventtime: point.eventtime, value })
  }
  return points
}

/** Ordinary least-squares slope, in value-units per second. Null without variance to fit. */
export function linearSlopePerSecond(points: readonly TimedValue[]): number | null {
  if (points.length < 2) return null
  const meanX = points.reduce((sum, point) => sum + point.eventtime, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    const dx = point.eventtime - meanX
    numerator += dx * (point.value - meanY)
    denominator += dx * dx
  }
  return denominator === 0 ? null : numerator / denominator
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

export function sensorKindFor(objectName: string): SensorKind | null {
  if (objectName === 'heater_bed') return 'bed'
  if (/^extruder\d*$/.test(objectName)) return 'extruder'
  if (objectName.startsWith('heater_generic ')) return 'heater'
  if (objectName.startsWith('temperature_fan ')) return 'temperatureFan'
  if (objectName.startsWith('temperature_sensor ')) return 'sensor'
  return null
}

export function sensorDisplayName(objectName: string): string {
  const separatorIndex = objectName.indexOf(' ')
  const name = separatorIndex < 0 ? objectName : objectName.slice(separatorIndex + 1)
  return name.replace(/[_-]+/g, ' ').trim()
}

/** Heaters and temperature fans accept a target; passive sensors only report. */
export function isSettableSensor(kind: SensorKind): boolean {
  return kind !== 'sensor'
}

export function discoverSensorObjects(objects: readonly string[]): string[] {
  const discovered = objects.filter(
    (objectName) =>
      objectName === 'heater_bed' ||
      /^extruder\d*$/.test(objectName) ||
      sensorObjectPrefixes.some((prefix) => objectName.startsWith(prefix)),
  )

  // Hotend first, bed second, then everything else in reported order: the two
  // heaters an operator looks at most never move as sensors come and go.
  const weight = (objectName: string): number => {
    const kind = sensorKindFor(objectName)
    if (kind === 'extruder') return 0
    if (kind === 'bed') return 1
    if (kind === 'heater') return 2
    if (kind === 'temperatureFan') return 3
    return 4
  }
  return [...new Set(discovered)].sort((left, right) => weight(left) - weight(right))
}

function isCurveRecord(value: unknown): value is StoredHeatCurves {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Stored curves for one printer, or nothing at all. A parse failure degrades to
 * an empty table rather than throwing: this is a convenience that makes an
 * estimate available sooner, and it may never cost the user a working card.
 */
function loadHeatCurves(scopeKeys: readonly string[]): StoredHeatCurves {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(heatCurveStorageKey) ?? '{}')
    if (!isCurveRecord(parsed)) return {}
    const scoped = readScoped(parsed as Record<string, unknown>, scopeKeys)
    return isCurveRecord(scoped) ? scoped : {}
  } catch {
    return {}
  }
}

function persistHeatCurves(scopeKeys: readonly string[], curves: StoredHeatCurves): void {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(heatCurveStorageKey) ?? '{}')
    const all = isCurveRecord(parsed) ? (parsed as Record<string, unknown>) : {}
    // Newest calibrations win: a heater that has been recalibrated repeatedly
    // keeps the recent ones and forgets the oldest, so this cannot grow forever.
    const trimmed: StoredHeatCurves = {}
    for (const [objectName, byFingerprint] of Object.entries(curves)) {
      const entries = Object.entries(byFingerprint).slice(-maximumStoredFingerprints)
      if (entries.length > 0) trimmed[objectName] = Object.fromEntries(entries)
    }
    window.localStorage.setItem(
      heatCurveStorageKey,
      JSON.stringify(writeScoped(all, scopeKeys, trimmed)),
    )
  } catch {
    // A full or unavailable store costs an estimate after the next reload and
    // nothing else, so it is never worth surfacing.
  }
}

export const useTelemetryStore = defineStore('telemetry', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const sensorObjects = ref<string[]>([])
  // These four buffers are shallowRef on purpose: every write replaces the
  // whole value (spread, Object.fromEntries, or reset), never mutates in
  // place, and the chart/stall/rate scans read thousands of points per second
  // — deep proxies would tax every one of those reads for reactivity nothing
  // uses. If you ever need to mutate a point or reading in place, replace the
  // container instead; an in-place write here will not trigger anything.
  const readings = shallowRef<Record<string, SensorReading>>({})
  const fans = shallowRef<Record<string, FanReading>>({})
  /** Raw `SET_PIN`-domain value (0..scale) last reported for each output pin. */
  const pins = shallowRef<Record<string, number | null>>({})
  const lastEventtime = ref<number | null>(null)
  const temperatureHistory = shallowRef<TemperatureHistoryPoint[]>([])
  const printers = usePrintersStore()
  const printerConfig = usePrinterConfigStore()
  /**
   * Learned curves, kept across reloads. Persisted rather than in memory —
   * which is what the previous model was, on the grounds that a reload cannot
   * know whether the hardware changed. It can: a curve is stored under a
   * fingerprint of the heater's own calibration, so changed hardware simply
   * does not match, and reverting the change finds its measurements again.
   */
  const heatCurves = ref<StoredHeatCurves>(loadHeatCurves(printers.activeScopeKeys))
  /**
   * Which printer the loaded curves belong to. Held rather than read at write
   * time because persisting is batched: a band that completes just before a
   * switch must still be filed under the printer that measured it.
   */
  let curveScopeKeys: readonly string[] = printers.activeScopeKeys
  /** Not reactive state, just the in-flight climb per heater. */
  const heatRecorders = new Map<string, HeatRecorderState>()
  let curvePersistTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * When each heater's target last changed. Bookkeeping rather than state: the
   * stall heuristic reads it to ignore everything measured before the printer
   * was asked for the temperature it is being judged against.
   */
  const targetRequestedAt = new Map<string, number>()
  const disposers: Array<() => void> = []
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let stopScopeWatch: WatchStopHandle | null = null
  let started = false
  let hasBackfilled = false
  let discoveryGeneration = 0
  let configuredSelection = ''

  function curveFor(objectName: string): HeatCurve | null {
    const fingerprint = fingerprintFor(printerConfig.heaterSettingsFor(objectName))
    return heatCurves.value[objectName]?.[fingerprint] ?? null
  }

  /**
   * Batched, because a band completes far more often than anyone reloads, and
   * a synchronous write on the status path would land in the middle of a
   * four-a-second feed.
   */
  function scheduleCurvePersist(): void {
    if (curvePersistTimer !== null) return
    curvePersistTimer = setTimeout(() => {
      curvePersistTimer = null
      persistHeatCurves(curveScopeKeys, heatCurves.value)
    }, curvePersistDelayMilliseconds)
  }

  const sensors = computed<SensorReading[]>(() =>
    sensorObjects.value.flatMap((objectName) => {
      const reading = readings.value[objectName]
      return reading ? [reading] : []
    }),
  )
  const hotend = computed<TemperatureTelemetry>(() => {
    const reading = readings.value.extruder
    return { temperature: reading?.temperature ?? null, target: reading?.target ?? null }
  })
  const bed = computed<TemperatureTelemetry>(() => {
    const reading = readings.value.heater_bed
    return { temperature: reading?.temperature ?? null, target: reading?.target ?? null }
  })
  const partFan = computed<FanReading>(
    () => fans.value.fan ?? { objectName: 'fan', speed: null, rpm: null },
  )

  /** Degrees per minute, fit over the recent history. Null without a trend to fit. */
  function computeRatePerMinute(objectName: string): number | null {
    const slopePerSecond = linearSlopePerSecond(
      pointsWithin(temperatureHistory.value, objectName, rateWindowSeconds),
    )
    return slopePerSecond === null ? null : slopePerSecond * 60
  }

  /**
   * Seconds to climb the remaining degrees, from what this heater has been
   * observed doing, or null when it has not been observed doing that.
   *
   * A fitted rate overstates every arrival, because both PID and MPC back
   * their power off well before the setpoint. This sums measured durations for
   * the parts of the range still to cross, which is why it can answer 200 → 220
   * as confidently as 27 → 220 — see `heatModel.ts` for how the parts are
   * learned and why a gap in them declines rather than being filled in.
   */
  function observedEstimate(objectName: string, from: number, to: number): number | null {
    const curve = curveFor(objectName)
    if (!curve) return null
    const seconds = estimateSeconds(curve, from, to)
    return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  /**
   * Seconds until an active target is reached. Prefers this heater's own
   * heat-up history when any exists, and otherwise falls back to the fitted
   * rate — never a naive division against zero movement. Null whenever even
   * the fallback would be a guess: no active target, no reading, a rate too
   * small to trust, or a rate moving the wrong way.
   */
  function computeSecondsToTarget(objectName: string, ratePerMinute: number | null): number | null {
    const reading = readings.value[objectName]
    if (
      !reading ||
      reading.target === null ||
      reading.target <= 0 ||
      reading.temperature === null
    ) {
      return null
    }
    const remaining = reading.target - reading.temperature
    if (Math.abs(remaining) <= targetSettleMargin) return 0

    if (remaining > 0) {
      const observed = observedEstimate(objectName, reading.temperature, reading.target)
      if (observed !== null) return observed
    }

    if (ratePerMinute === null || Math.abs(ratePerMinute) < rateNoiseFloorPerMinute) return null
    if (Math.sign(remaining) !== Math.sign(ratePerMinute)) return null

    const seconds = (remaining / ratePerMinute) * 60
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  /**
   * Feeds one status sample to this heater's recorder and stores whatever it
   * completed.
   *
   * Reads the merge stream directly rather than `temperatureHistory`, which is
   * throttled to a point a second for the chart: a band five degrees wide can
   * be crossed in a couple of seconds, and timing it from a thinned feed would
   * quantise most of its duration away.
   */
  function recordHeatSample(
    objectName: string,
    temperature: number | null,
    target: number | null,
    power: number | null,
    eventtime: number | undefined,
  ): void {
    if (eventtime === undefined || temperature === null) return
    let state = heatRecorders.get(objectName)
    if (!state) {
      state = emptyRecorderState()
      heatRecorders.set(objectName, state)
    }

    const result = recordObservation(
      state,
      { eventtime, temperature, target, power },
      {
        maximumPower: printerConfig.maximumPowerFor(objectName),
        settleMargin: targetSettleMargin,
      },
    )
    if (result.bands.length === 0 && !result.approach) return

    const fingerprint = fingerprintFor(printerConfig.heaterSettingsFor(objectName))
    const existing = heatCurves.value[objectName]?.[fingerprint] ?? emptyCurve()
    heatCurves.value = {
      ...heatCurves.value,
      [objectName]: {
        ...heatCurves.value[objectName],
        [fingerprint]: applyRecording(existing, result),
      },
    }
    scheduleCurvePersist()
  }

  /**
   * True only for a heater actively short of a higher target that has not
   * gained ground over the stall window. This is an early-warning heuristic,
   * not a stand-in for Klipper's own `verify_heater` fault: its thresholds are
   * configured per heater and are not read here, so this may fire after,
   * before, or never relative to that fault depending on configuration.
   * Deliberately scoped to heating only — a cooling target has no active
   * drive, so "not falling fast" would false-positive constantly.
   *
   * **Only readings taken since the target was set count.** Without that this
   * fires the instant a target is requested on a cold printer: the window looks
   * back 45 seconds, and on a machine that has been sitting idle every one of
   * those readings is flat — a heater accused of not climbing before it has
   * been asked to. The grace period on top covers the first seconds after the
   * request, where the block is absorbing power without the sensor showing it
   * yet.
   */
  function computeStalled(objectName: string): boolean {
    const reading = readings.value[objectName]
    if (!reading || reading.target === null || reading.temperature === null) return false
    if (reading.target - reading.temperature <= stallSettleMargin) return false

    const requestedAt = targetRequestedAt.get(objectName)
    const latest = lastEventtime.value
    if (requestedAt !== undefined && latest !== null && latest - requestedAt < stallGraceSeconds) {
      return false
    }

    const points = pointsWithin(temperatureHistory.value, objectName, stallWindowSeconds).filter(
      (point) => requestedAt === undefined || point.eventtime >= requestedAt,
    )
    if (points.length < 2) return false
    const spanSeconds = points[points.length - 1]!.eventtime - points[0]!.eventtime
    if (spanSeconds < stallMinimumSpanSeconds) return false

    const gained = points[points.length - 1]!.value - points[0]!.value
    return gained < stallEpsilon
  }

  interface SettableSensorStatus {
    ratePerMinute: number | null
    secondsToTarget: number | null
    stalled: boolean
  }

  /**
   * One scan pass per status push, shared by every consumer. The stall check,
   * the ETA, and the fitted rate each walk a window of `temperatureHistory` —
   * up to ~1200 points — and the Temperatures card reads all three per heater,
   * per render, several times per row. Left as bare functions those walks
   * multiplied out per call; cached here they happen once per push and a
   * row's read is a Map lookup. The public functions below keep their
   * signatures, so callers cannot tell — they just stop paying.
   */
  const sensorStatuses = computed(() => {
    const statuses = new Map<string, SettableSensorStatus>()
    for (const [objectName, reading] of Object.entries(readings.value)) {
      if (!isSettableSensor(reading.kind)) continue
      const ratePerMinute = computeRatePerMinute(objectName)
      statuses.set(objectName, {
        ratePerMinute,
        secondsToTarget: computeSecondsToTarget(objectName, ratePerMinute),
        stalled: computeStalled(objectName),
      })
    }
    return statuses
  })

  /** Degrees per minute, fit over the recent history. Null without a trend to fit. */
  function rateOfChange(objectName: string): number | null {
    const status = sensorStatuses.value.get(objectName)
    return status ? status.ratePerMinute : computeRatePerMinute(objectName)
  }

  /** See `computeSecondsToTarget` for how the estimate is made and declined. */
  function timeToTarget(objectName: string): number | null {
    const status = sensorStatuses.value.get(objectName)
    return status
      ? status.secondsToTarget
      : computeSecondsToTarget(objectName, computeRatePerMinute(objectName))
  }

  /** See `computeStalled` for what counts as a stall and why. */
  function isStalled(objectName: string): boolean {
    return sensorStatuses.value.get(objectName)?.stalled ?? computeStalled(objectName)
  }

  function mergeSensor(objectName: string, update: unknown, eventtime?: number): boolean {
    if (!isRecord(update)) return false
    const kind = sensorKindFor(objectName)
    if (!kind) return false

    const previous = readings.value[objectName] ?? {
      objectName,
      name: sensorDisplayName(objectName),
      kind,
      temperature: null,
      target: null,
      power: null,
      speed: null,
      isSettable: isSettableSensor(kind),
    }
    const temperature = finiteNumber(update.temperature)
    const target = finiteNumber(update.target)
    const power = finiteNumber(update.power)
    const speed = finiteNumber(update.speed)
    if (
      temperature === undefined &&
      target === undefined &&
      power === undefined &&
      speed === undefined
    ) {
      return false
    }

    const finalTemperature = temperature === undefined ? previous.temperature : temperature
    const finalTarget = target === undefined ? previous.target : target
    readings.value = {
      ...readings.value,
      [objectName]: {
        ...previous,
        temperature: finalTemperature,
        target: finalTarget,
        power: power === undefined ? previous.power : power,
        speed: speed === undefined ? previous.speed : speed,
      },
    }
    if (isSettableSensor(kind)) {
      // The stall heuristic reads this to ignore everything measured before the
      // printer was asked for the temperature it is being judged against.
      if (finalTarget !== previous.target && eventtime !== undefined) {
        targetRequestedAt.set(objectName, eventtime)
      }
      recordHeatSample(
        objectName,
        finalTemperature,
        finalTarget,
        power === undefined ? previous.power : power,
        eventtime,
      )
    }
    return temperature !== undefined
  }

  function mergeFan(objectName: string, update: unknown): boolean {
    if (!isRecord(update)) return false
    const previous = fans.value[objectName] ?? { objectName, speed: null, rpm: null }
    const speed = finiteNumber(update.speed)
    const rpm = finiteNumber(update.rpm)
    if (speed === undefined && rpm === undefined) return false

    fans.value = {
      ...fans.value,
      [objectName]: {
        objectName,
        speed: speed === undefined ? previous.speed : speed,
        rpm: rpm === undefined ? previous.rpm : rpm,
      },
    }
    return true
  }

  function mergePin(objectName: string, update: unknown): boolean {
    if (!isRecord(update)) return false
    const value = finiteNumber(update.value)
    if (value === undefined) return false
    pins.value = { ...pins.value, [objectName]: value }
    return true
  }

  function mergeStatus(status: Record<string, unknown>, eventtime?: number): void {
    let temperatureChanged = false
    let changed = false

    for (const [objectName, update] of Object.entries(status)) {
      if (sensorKindFor(objectName)) {
        const sensorChanged = mergeSensor(objectName, update, eventtime)
        temperatureChanged = temperatureChanged || sensorChanged
        changed = true
        continue
      }
      if (isFanObject(objectName)) {
        changed = mergeFan(objectName, update) || changed
        continue
      }
      if (isOutputPinObject(objectName)) changed = mergePin(objectName, update) || changed
    }

    if (!changed || eventtime === undefined || !Number.isFinite(eventtime)) return
    lastEventtime.value = eventtime
    if (!temperatureChanged) return

    // A push that lands before discovery has named the sensors would record a
    // point with no readings in it — useless in itself, and enough to look like
    // history to anything asking whether any exists.
    if (sensorObjects.value.length === 0) return

    // Holds the history to one point a second whatever the feed does, so the
    // cap above really is twenty minutes. See `historyIntervalSeconds`.
    const previous = temperatureHistory.value[temperatureHistory.value.length - 1]
    if (previous && eventtime - previous.eventtime < historyIntervalSeconds) return

    const sample = (read: (reading: SensorReading) => number | null) =>
      Object.fromEntries(
        sensorObjects.value.map((objectName) => {
          const reading = readings.value[objectName]
          return [objectName, reading ? read(reading) : null]
        }),
      )

    temperatureHistory.value = [
      ...temperatureHistory.value,
      {
        eventtime,
        values: sample((reading) => reading.temperature),
        // Recorded rather than read from the live reading at draw time, because
        // a target line drawn flat at whatever the target is now is a claim
        // about the past that the printer never made.
        targets: sample((reading) => reading.target),
        powers: sample((reading) => reading.power),
      },
    ].slice(-maximumHistoryPoints)
  }

  function handleSnapshot(snapshot: PrinterObjectSnapshot): void {
    mergeStatus(snapshot.status, snapshot.eventtime)
  }

  function handleStatusUpdate(notification: JsonRpcNotification): void {
    const status = notification.params[0]
    const eventtime = notification.params[1]
    if (!isRecord(status)) return
    mergeStatus(status, typeof eventtime === 'number' ? eventtime : undefined)
  }

  async function discoverSensors(): Promise<void> {
    const generation = ++discoveryGeneration

    try {
      const result = await moonraker.rpcCall('printer.objects.list')
      if (generation !== discoveryGeneration) return

      const discovered = discoverSensorObjects(result.objects)
      const controllableFans = result.objects.filter(isFanObject)
      const outputPins = result.objects.filter(isOutputPinObject)
      sensorObjects.value = discovered

      // Sensors that disappeared from the configuration must not keep reporting
      // their last value as if it were live.
      const known = new Set([...discovered, ...controllableFans, ...outputPins])
      readings.value = Object.fromEntries(
        Object.entries(readings.value).filter(([objectName]) => known.has(objectName)),
      )
      fans.value = Object.fromEntries(
        Object.entries(fans.value).filter(([objectName]) => known.has(objectName)),
      )
      pins.value = Object.fromEntries(
        Object.entries(pins.value).filter(([objectName]) => known.has(objectName)),
      )

      const selection: PrinterObjectSelection = {}
      for (const objectName of [...discovered, ...controllableFans, ...outputPins])
        selection[objectName] = null

      const nextConfiguredSelection = JSON.stringify(selection)
      if (nextConfiguredSelection !== configuredSelection) {
        configuredSelection = nextConfiguredSelection
        await moonraker.setObjectSubscription(telemetrySubscriptionKey, selection)
      }
      // Always attempted, not only when the subscription changed: a discovery
      // cycle whose own backfill declined (the subscription snapshot had not
      // reported an eventtime yet, or it lost a race with a later cycle) must
      // get another chance the next time Klipper is reported ready, which is
      // exactly the cycle that runs this same selection again.
      await backfillHistory(generation)
    } catch {
      // A lifecycle change will retry discovery when Klipper becomes ready again.
    }
  }

  /**
   * Seeds the chart from Moonraker's own recording, so a reload does not stare
   * at an empty plot for five minutes while it earns its history back.
   *
   * The server is the right place to take this from rather than anything kept
   * locally: it was recording while the tab was closed, it was recording for
   * the phone that looked at the same printer an hour ago, and it records the
   * same three quantities at the same one-a-second cadence this store keeps. A
   * local copy could only ever cover the one browser that wrote it.
   *
   * The samples carry no timestamps — they are evenly spaced and end at the
   * present — so they are dated backwards from the newest `eventtime` at the
   * interval Moonraker samples on. That mapping is what makes them line up with
   * live points arriving afterwards.
   */
  async function backfillHistory(generation: number): Promise<void> {
    // Once per session. Live readings are the better record — their timestamps
    // are real rather than reconstructed — so this only ever fills in front of
    // them, and a reconnect does not re-seed over history already collected.
    //
    // The flag is set only once an attempt reaches a definitive outcome —
    // never at entry. A discovery cycle can lose a race (its subscription
    // snapshot has not reported an eventtime yet, or a later cycle finishes
    // first and makes this one stale) without that being the answer for the
    // session: latching here regardless used to let a losing cycle spend the
    // one attempt permanently, so the chart stayed empty for a session whose
    // very next discovery cycle would otherwise have succeeded — the failure
    // this reload was written to prevent, reappearing through a side door.
    if (hasBackfilled) return

    let store: Awaited<ReturnType<typeof moonraker.rpcCall<'server.temperature_store'>>>
    try {
      store = await moonraker.rpcCall('server.temperature_store', { include_monitors: false })
    } catch {
      // A read that is allowed to fail is not a command: an older Moonraker, or
      // one with the data store disabled, simply starts the chart empty. That
      // will not change mid-session, so it is fine to stop trying.
      hasBackfilled = true
      return
    }
    if (generation !== discoveryGeneration) return

    const latest = lastEventtime.value
    if (latest === null) return

    // None of the discovered sensors have anything recorded — nothing to seed
    // from, ever, for this set of sensors. Guarded explicitly rather than
    // folded into the Math.min below: spreading an empty array into it leaves
    // only `maximumHistoryPoints`, which reads as a full, valid window and
    // would have built that many samples out of nothing but null values.
    const tracked = sensorObjects.value.filter((objectName) => objectName in store)
    if (tracked.length === 0) {
      hasBackfilled = true
      return
    }

    const length = Math.min(
      maximumHistoryPoints,
      ...tracked.map((objectName) => store[objectName]?.temperatures?.length ?? 0),
    )
    if (!Number.isFinite(length) || length < 2) {
      hasBackfilled = true
      return
    }
    hasBackfilled = true

    const seeded: TemperatureHistoryPoint[] = []
    for (let index = 0; index < length; index += 1) {
      // Counted back from the newest sample, which is the present.
      const age = (length - 1 - index) * moonrakerStoreIntervalSeconds
      const at = (series: number[] | undefined): number | null => {
        const value = series?.[series.length - length + index]
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      }
      seeded.push({
        eventtime: latest - age,
        values: Object.fromEntries(
          tracked.map((objectName) => [objectName, at(store[objectName]?.temperatures)]),
        ),
        targets: Object.fromEntries(
          tracked.map((objectName) => [objectName, at(store[objectName]?.targets)]),
        ),
        powers: Object.fromEntries(
          tracked.map((objectName) => [objectName, at(store[objectName]?.powers)]),
        ),
      })
    }

    // Never in front of a reading that was actually observed: the newest seeded
    // sample is the present, which the live feed reports itself, and anything
    // else overlapping is a reconstruction of a moment already recorded better.
    const oldestLive = temperatureHistory.value[0]?.eventtime ?? latest
    const kept = seeded.filter((point) => point.eventtime < oldestLive)
    temperatureHistory.value = [...kept, ...temperatureHistory.value].slice(-maximumHistoryPoints)
  }

  /**
   * Another printer has other sensors, so every reading, the history behind the
   * chart, and the discovery bookkeeping all belong to the machine we just left.
   *
   * Learned curves are not here: they belong to the printer's identity rather
   * than to this connection, so `scopeChanged` handles them.
   */
  function printerChanged(): void {
    sensorObjects.value = []
    readings.value = {}
    fans.value = {}
    pins.value = {}
    lastEventtime.value = null
    temperatureHistory.value = []
    heatRecorders.clear()
    targetRequestedAt.clear()

    // Discovery has to run again for the new machine, and any in-flight
    // discovery against the old one must not land after it.
    hasBackfilled = false
    discoveryGeneration += 1
    configuredSelection = ''
  }

  /**
   * A different printer's curves. The batched write is flushed to the printer
   * that measured it first: persisting reads `curveScopeKeys` rather than the
   * live selection precisely so a band completing just before a switch cannot be
   * filed under the printer being switched to.
   */
  function scopeChanged(): void {
    if (curvePersistTimer !== null) {
      clearTimeout(curvePersistTimer)
      curvePersistTimer = null
      persistHeatCurves(curveScopeKeys, heatCurves.value)
    }
    curveScopeKeys = printers.activeScopeKeys
    heatCurves.value = loadHeatCurves(curveScopeKeys)
  }

  function start(): void {
    if (started) return
    started = true

    disposers.push(
      moonraker.onObjectSnapshot(handleSnapshot as ObjectSnapshotHandler),
      moonraker.onNotification('notify_status_update', handleStatusUpdate),
    )

    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopScopeWatch = watch(() => printers.activeScopeKeys.join(','), scopeChanged)

    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (isReady) void discoverSensors()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    hasBackfilled = false
    discoveryGeneration += 1
    configuredSelection = ''
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    stopScopeWatch?.()
    stopScopeWatch = null
    while (disposers.length > 0) disposers.pop()?.()
    void moonraker.removeObjectSubscription(telemetrySubscriptionKey)
  }

  return {
    sensorObjects,
    readings,
    fans,
    pins,
    sensors,
    hotend,
    bed,
    partFan,
    lastEventtime,
    temperatureHistory,
    heatCurves,
    rateOfChange,
    timeToTarget,
    isStalled,
    start,
    stop,
    discoverSensors,
  }
})

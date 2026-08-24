import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  JsonRpcNotification,
  NotificationHandler,
  ObjectSnapshotHandler,
} from '@/services/moonraker'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import {
  discoverSensorObjects,
  pointsWithin,
  sensorDisplayName,
  useTelemetryStore,
  type SensorReading,
} from '@/stores/telemetry'

function reading(overrides: Partial<SensorReading> & { objectName: string }): SensorReading {
  return {
    name: overrides.objectName,
    kind: 'sensor',
    temperature: null,
    target: null,
    power: null,
    speed: null,
    isSettable: true,
    ...overrides,
  }
}

describe('sensor discovery', () => {
  it('keeps every reported heater and sensor with the hotend and bed first', () => {
    expect(
      discoverSensorObjects([
        'temperature_sensor y_stepper',
        'heater_bed',
        'toolhead',
        'temperature_fan chamber',
        'extruder',
        'heater_generic warmer',
        'gcode_macro TEST',
      ]),
    ).toEqual([
      'extruder',
      'heater_bed',
      'heater_generic warmer',
      'temperature_fan chamber',
      'temperature_sensor y_stepper',
    ])
  })

  it('names sensors from the part of the object after its section', () => {
    expect(sensorDisplayName('temperature_sensor y_stepper')).toBe('y stepper')
    expect(sensorDisplayName('heater_bed')).toBe('heater bed')
  })
})

describe('pointsWithin', () => {
  const history = [0, 100, 200, 300, 400].map((eventtime) => ({
    eventtime,
    values: { extruder: eventtime },
  }))

  it('excludes samples older than the window by default', () => {
    expect(pointsWithin(history, 'extruder', 150).map((p) => p.eventtime)).toEqual([300, 400])
  })

  it('keeps one extra sample per unit of bleedBefore, for a line to anchor from', () => {
    expect(pointsWithin(history, 'extruder', 150, 'values', 1).map((p) => p.eventtime)).toEqual([
      200, 300, 400,
    ])
    expect(pointsWithin(history, 'extruder', 150, 'values', 2).map((p) => p.eventtime)).toEqual([
      100, 200, 300, 400,
    ])
  })

  it('never bleeds past the start of the history', () => {
    expect(pointsWithin(history, 'extruder', 150, 'values', 10).map((p) => p.eventtime)).toEqual([
      0, 100, 200, 300, 400,
    ])
  })
})

describe('telemetry store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('subscribes to every discovered sensor and merges partial updates', async () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    let statusHandler: NotificationHandler | undefined

    const setSubscription = vi
      .spyOn(moonraker, 'setObjectSubscription')
      .mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      objects: ['extruder', 'heater_bed', 'temperature_sensor chamber', 'fan', 'heater_fan hotend'],
    } as never)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const telemetry = useTelemetryStore()
    telemetry.start()
    await telemetry.discoverSensors()

    expect(setSubscription).toHaveBeenCalledWith('alabaster.telemetry', {
      extruder: null,
      heater_bed: null,
      'temperature_sensor chamber': null,
      fan: null,
      'heater_fan hotend': null,
    })

    snapshotHandler?.({
      eventtime: 10,
      status: {
        extruder: { temperature: 27.75, target: 0, power: 0 },
        heater_bed: { temperature: 26.95, target: 60, power: 0.4 },
        'temperature_sensor chamber': { temperature: 24.1 },
        fan: { speed: 0.25, rpm: null },
      },
    })

    expect(telemetry.hotend).toEqual({ temperature: 27.75, target: 0 })
    expect(telemetry.bed).toEqual({ temperature: 26.95, target: 60 })
    expect(telemetry.partFan).toEqual({ objectName: 'fan', speed: 0.25, rpm: null })
    expect(telemetry.readings.heater_bed?.power).toBe(0.4)
    expect(telemetry.readings['temperature_sensor chamber']?.isSettable).toBe(false)
    expect(telemetry.readings.heater_bed?.isSettable).toBe(true)
    expect(telemetry.lastEventtime).toBe(10)
    // Targets and powers are recorded beside the readings, so a chart can draw
    // what the printer was asked for rather than assuming it was always what it
    // is asked for now.
    expect(telemetry.temperatureHistory).toEqual([
      {
        eventtime: 10,
        values: {
          extruder: 27.75,
          heater_bed: 26.95,
          'temperature_sensor chamber': 24.1,
        },
        targets: {
          extruder: 0,
          heater_bed: 60,
          'temperature_sensor chamber': null,
        },
        powers: {
          extruder: 0,
          heater_bed: 0.4,
          'temperature_sensor chamber': null,
        },
      },
    ])

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ extruder: { temperature: 210.4 }, fan: { speed: 0.5 } }, 11],
    }
    statusHandler?.(notification)

    expect(telemetry.hotend).toEqual({ temperature: 210.4, target: 0 })
    expect(telemetry.partFan.speed).toBe(0.5)
    expect(telemetry.temperatureHistory.at(-1)?.values.extruder).toBe(210.4)
  })

  /*
   * A reload used to stare at an empty plot for five minutes while it earned
   * its history back. Moonraker was recording the whole time — including while
   * the tab was closed, and for whatever else looked at the same printer — so
   * the chart is seeded from the server rather than from anything local, which
   * could only ever cover the one browser that wrote it.
   */
  it('seeds its history from the recording Moonraker already kept', async () => {
    const moonraker = useMoonrakerStore()
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    // The real client emits the subscription's opening snapshot before this
    // promise resolves, which is what gives the seeded samples an eventtime to
    // be dated back from. Modelling that ordering is the point of the mock.
    vi.spyOn(moonraker, 'setObjectSubscription').mockImplementation(() => {
      snapshotHandler?.({
        eventtime: 1_000,
        status: { extruder: { temperature: 50, target: 215, power: 1 } },
      })
      return Promise.resolve(undefined)
    })
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
      if (method === 'printer.objects.list') {
        return Promise.resolve({ objects: ['extruder'] } as never)
      }
      return Promise.resolve({
        extruder: {
          temperatures: [20, 30, 40, 50],
          targets: [0, 0, 215, 215],
          powers: [0, 0, 1, 1],
        },
      } as never)
    })

    const telemetry = useTelemetryStore()
    telemetry.start()
    await telemetry.discoverSensors()

    const history = telemetry.temperatureHistory
    // Three seeded samples plus the live one: the newest seeded sample is the
    // present, which the feed reports itself, so it is dropped rather than
    // drawn twice.
    expect(history.map((point) => point.values.extruder)).toEqual([20, 30, 40, 50])
    expect(history.map((point) => point.eventtime)).toEqual([997, 998, 999, 1_000])
    expect(pointsWithin(history, 'extruder', 600, 'targets').map((p) => p.value)).toEqual([
      0, 0, 215, 215,
    ])
  })

  it('starts empty rather than failing when the server keeps no such recording', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
      if (method === 'printer.objects.list') {
        return Promise.resolve({ objects: ['extruder'] } as never)
      }
      // An older Moonraker, or one with its data store switched off. A read
      // that is allowed to fail is not a command.
      return Promise.reject(new Error('Unknown method'))
    })

    const telemetry = useTelemetryStore()
    telemetry.start()
    await expect(telemetry.discoverSensors()).resolves.toBeUndefined()
    expect(telemetry.temperatureHistory).toEqual([])
    expect(telemetry.sensorObjects).toEqual(['extruder'])
  })

  it('starts empty rather than seeding fabricated points when the recording covers none of the discovered sensors', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
      if (method === 'printer.objects.list') {
        return Promise.resolve({ objects: ['extruder'] } as never)
      }
      // The store answered, but has nothing recorded for the extruder — an
      // empty spread into `Math.min` used to leave the cap itself standing
      // as a seemingly valid length, seeding a screenful of samples that
      // carried no reading for any tracked sensor.
      return Promise.resolve({} as never)
    })

    const telemetry = useTelemetryStore()
    telemetry.start()
    telemetry.lastEventtime = 1_000
    await telemetry.discoverSensors()

    expect(telemetry.temperatureHistory).toEqual([])
  })

  /*
   * A reconnect right after the tab comes back from being idle can find the
   * subscription's opening snapshot slower to report an eventtime than the
   * backfill attempt that follows it. Latching "done" the moment that attempt
   * is made — rather than once it actually succeeds — used to spend the
   * session's only try on a race it had already lost, leaving the chart
   * empty until a full page reload started the flag over.
   */
  it('retries backfilling on the next discovery cycle when the first found no live eventtime yet', async () => {
    const moonraker = useMoonrakerStore()
    let statusHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
      if (method === 'printer.objects.list') {
        return Promise.resolve({ objects: ['extruder'] } as never)
      }
      return Promise.resolve({
        extruder: { temperatures: [20, 30, 40, 50], targets: [0, 0, 0, 0], powers: [0, 0, 0, 0] },
      } as never)
    })

    const telemetry = useTelemetryStore()
    telemetry.start()

    // The subscription's own snapshot has not landed yet, so there is no
    // eventtime to date seeded samples from.
    await telemetry.discoverSensors()
    expect(telemetry.temperatureHistory).toEqual([])

    // The live feed catches up...
    statusHandler?.({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ extruder: { temperature: 50 } }, 1_000],
    })
    // ...and Klipper is reported ready again — the same cycle a reconnect
    // after an idle tab runs, with the selection unchanged from before.
    await telemetry.discoverSensors()

    expect(telemetry.temperatureHistory.map((point) => point.values.extruder)).toEqual([
      20, 30, 40, 50,
    ])
  })

  it('drops readings for sensors the printer stopped reporting', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    const rpcCall = vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({
      objects: ['extruder', 'temperature_sensor chamber'],
    } as never)
    let snapshotHandler: ObjectSnapshotHandler | undefined
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation((handler) => {
      snapshotHandler = handler
      return () => undefined
    })
    vi.spyOn(moonraker, 'onNotification').mockImplementation(() => () => undefined)

    const telemetry = useTelemetryStore()
    telemetry.start()
    await telemetry.discoverSensors()
    snapshotHandler?.({
      eventtime: 1,
      status: {
        extruder: { temperature: 30 },
        'temperature_sensor chamber': { temperature: 24 },
      },
    })
    expect(telemetry.sensors).toHaveLength(2)

    rpcCall.mockResolvedValue({ objects: ['extruder'] } as never)
    await telemetry.discoverSensors()

    expect(telemetry.sensors.map((sensor) => sensor.objectName)).toEqual(['extruder'])
    expect(telemetry.readings['temperature_sensor chamber']).toBeUndefined()
  })
})

describe('heat-up history', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  async function withLiveExtruder() {
    const moonraker = useMoonrakerStore()
    let statusHandler: NotificationHandler | undefined
    vi.spyOn(moonraker, 'setObjectSubscription').mockResolvedValue(undefined)
    vi.spyOn(moonraker, 'rpcCall').mockResolvedValue({ objects: ['extruder'] } as never)
    vi.spyOn(moonraker, 'onObjectSnapshot').mockImplementation(() => () => undefined)
    vi.spyOn(moonraker, 'onNotification').mockImplementation((method, handler) => {
      if (method === 'notify_status_update') statusHandler = handler
      return () => undefined
    })

    const telemetry = useTelemetryStore()
    telemetry.start()
    await telemetry.discoverSensors()

    function push(eventtime: number, update: Record<string, unknown>): void {
      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'notify_status_update',
        params: [{ extruder: update }, eventtime],
      }
      statusHandler?.(notification)
    }

    return { telemetry, push }
  }

  /*
   * The false positive a real printer produced. Ask a cold, idle machine for a
   * temperature and the stall window looks back across 45 seconds of it having
   * been sitting still — so the heater is convicted of not climbing before it
   * was ever asked to. Only readings taken since the request may be judged, and
   * a grace period covers the first seconds where the block absorbs power
   * without the sensor showing it.
   */
  it('never calls a heater stalled on readings from before its target was set', async () => {
    const { telemetry, push } = await withLiveExtruder()

    // A minute of idle at room temperature, then the target arrives.
    for (let eventtime = 0; eventtime <= 60; eventtime += 5) {
      push(eventtime, { temperature: 27, target: 0 })
    }
    push(61, { target: 200 })

    // Flat for a while afterwards — but the flat stretch that would convict it
    // is almost entirely the idle minute before anyone asked for heat.
    push(63, { temperature: 27 })
    expect(telemetry.isStalled('extruder')).toBe(false)

    // Still inside the grace period, where a real block has absorbed power the
    // sensor has not reported yet.
    push(65, { temperature: 27.1 })
    expect(telemetry.isStalled('extruder')).toBe(false)

    // Past the grace period, but there is not yet a stall window's worth of
    // readings taken since the request, so no verdict is reached.
    push(80, { temperature: 27.2 })
    expect(telemetry.isStalled('extruder')).toBe(false)

    // A full window of post-request readings with nothing gained does convict.
    push(110, { temperature: 27.3 })
    expect(telemetry.isStalled('extruder')).toBe(true)
  })

  /*
   * The defect this replaced. `maximumHistoryPoints` claimed to be sized
   * against the widest chart window rather than an assumed interval, and had
   * assumed one: Moonraker pushes about four times a second, so a naive
   * point-per-push cap covered a fraction of the window's duration. A cap is a
   * count and a window is a duration, so the rate is what had to be held.
   */
  it('spans its widest chart window at the rate a real printer pushes', async () => {
    const { telemetry, push } = await withLiveExtruder()

    // Twenty-one minutes at the measured 250ms cadence.
    for (let sample = 0; sample <= 21 * 60 * 4; sample += 1) {
      push(sample * 0.25, { temperature: 25 + (sample % 40) * 0.1, target: 0 })
    }

    const history = telemetry.temperatureHistory
    const span = history[history.length - 1]!.eventtime - history[0]!.eventtime
    expect(span).toBeGreaterThanOrEqual(20 * 60)
    expect(history.length).toBeLessThanOrEqual(1201)
  })

  it('records what each heater was asked for beside what it read', async () => {
    const { telemetry, push } = await withLiveExtruder()

    // Klipper reports the whole object, so a target change arrives alongside a
    // reading. A push carrying only a target records nothing, by design: the
    // history is keyed to temperature samples.
    push(0, { temperature: 25, target: 0, power: 0 })
    push(2, { temperature: 30, target: 215, power: 1 })
    push(4, { temperature: 60, target: 215, power: 1 })

    // A target line drawn flat at the current setpoint is a claim about the
    // past the printer never made, so the past has to be recorded as it went.
    const targets = pointsWithin(telemetry.temperatureHistory, 'extruder', 600, 'targets')
    expect(targets.map((point) => point.value)).toEqual([0, 215, 215])

    const powers = pointsWithin(telemetry.temperatureHistory, 'extruder', 600, 'powers')
    expect(powers.map((point) => point.value)).toEqual([0, 1, 1])

    // And the default is still the temperature, so nothing that read this
    // before had to change.
    expect(pointsWithin(telemetry.temperatureHistory, 'extruder', 600).map((p) => p.value)).toEqual(
      [25, 30, 60],
    )
  })

  /**
   * Drives a climb through the real merge path, so what is learned comes from
   * the same feed a printer delivers rather than from a fixture handed to the
   * model directly.
   */
  function pushClimb(
    push: (eventtime: number, update: Record<string, unknown>) => void,
    options: { from: number; target: number; startAt?: number; easesOffAt?: number },
  ): number {
    const { from, target, startAt = 0, easesOffAt = target - 12 } = options
    let temperature = from
    let eventtime = startAt
    push(eventtime, { temperature, target, power: 1 })
    while (temperature < target) {
      const easing = temperature >= easesOffAt
      const rate = (1 / (0.9 + temperature / 90)) * (easing ? 0.28 : 1)
      eventtime += 0.25
      temperature = Math.min(target, temperature + rate * 0.25)
      push(eventtime, { temperature, target, power: easing ? 0.35 : 1 })
    }
    push(eventtime + 0.25, { temperature: target, target, power: 0.3 })
    return eventtime + 0.25
  }

  /*
   * The whole point of the rewrite, asserted through the store: a climb from
   * cold teaches the heater's curve, and the next estimate is drawn from what
   * was measured rather than from a rate fitted to the last thirty seconds.
   */
  it('learns a climb from the live feed and estimates the next one from it', async () => {
    const { telemetry, push } = await withLiveExtruder()

    const arrivedAt = pushClimb(push, { from: 25, target: 220 })
    expect(Object.keys(telemetry.heatCurves.extruder ?? {})).toHaveLength(1)

    // Now most of the way there, with a fresh request to the same temperature.
    push(arrivedAt + 1, { temperature: 30, target: 0, power: 0 })
    push(arrivedAt + 2, { temperature: 200, target: 220, power: 1 })

    const estimate = telemetry.timeToTarget('extruder')
    expect(estimate).not.toBeNull()
    // A real duration for the slowest twenty degrees of the range, not the
    // seconds-per-degree average the old model would have quoted.
    expect(estimate!).toBeGreaterThan(20)
    expect(estimate!).toBeLessThan(arrivedAt)
  })

  /*
   * The reason curves are stored under a fingerprint rather than checked
   * against one: a recalibration does not destroy what was measured before it,
   * and putting the old constants back finds those measurements again.
   */
  it('files what it learns under the calibration it was learned with', async () => {
    const { telemetry, push } = await withLiveExtruder()
    const printerConfig = usePrinterConfigStore()
    const calibration = (kp: number) => ({
      extruder: { control: 'pid', max_power: 1, pid_kp: kp, pid_ki: 1.5, pid_kd: 800 },
    })

    printerConfig.settings = calibration(70.787)
    pushClimb(push, { from: 25, target: 220 })
    const learned = Object.keys(telemetry.heatCurves.extruder ?? {})
    expect(learned).toHaveLength(1)

    // Recalibrated: the old table is untouched, and nothing answers yet.
    printerConfig.settings = calibration(66.2)
    push(9_000, { temperature: 200, target: 220, power: 1 })
    expect(telemetry.timeToTarget('extruder')).toBeNull()
    expect(Object.keys(telemetry.heatCurves.extruder ?? {})).toEqual(learned)

    // Reverted: the measurements taken under those constants are still there.
    printerConfig.settings = calibration(70.787)
    expect(telemetry.timeToTarget('extruder')).not.toBeNull()
  })

  it('keeps what it learned across a reload, scoped to the printer it watched', async () => {
    vi.useFakeTimers()
    try {
      const first = await withLiveExtruder()
      pushClimb(first.push, { from: 25, target: 220 })
      // Writes are batched off the status path.
      vi.advanceTimersByTime(5_000)
    } finally {
      vi.useRealTimers()
    }

    expect(window.localStorage.getItem('alabaster.telemetry.heatCurves.v1')).toContain('extruder')

    // A reload: a new store over the same browser storage.
    setActivePinia(createPinia())
    const reloaded = useTelemetryStore()
    expect(Object.keys(reloaded.heatCurves.extruder ?? {})).toHaveLength(1)
  })

  it('starts empty rather than throwing on a corrupt stored curve', () => {
    window.localStorage.setItem('alabaster.telemetry.heatCurves.v1', '{not json')
    setActivePinia(createPinia())
    expect(useTelemetryStore().heatCurves).toEqual({})
  })
})

describe('temperature rate and target estimates', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  function withHistory(points: ReadonlyArray<readonly [number, number]>) {
    const telemetry = useTelemetryStore()
    telemetry.temperatureHistory = points.map(([eventtime, value]) => ({
      eventtime,
      values: { extruder: value },
    }))
    return telemetry
  }

  it('fits a rate of change in degrees per minute from recent history', () => {
    const telemetry = withHistory([
      [0, 25],
      [30, 40],
    ])
    expect(telemetry.rateOfChange('extruder')).toBeCloseTo(30)
  })

  it('has no rate without at least two points to fit', () => {
    const telemetry = withHistory([[0, 25]])
    expect(telemetry.rateOfChange('extruder')).toBeNull()
  })

  it('estimates time to target from the fitted rate', () => {
    const telemetry = withHistory([
      [0, 25],
      [30, 40],
    ])
    telemetry.readings = {
      extruder: reading({ objectName: 'extruder', kind: 'extruder', temperature: 40, target: 100 }),
    }
    expect(telemetry.timeToTarget('extruder')).toBeCloseTo(120)
  })

  it('treats a target within the settle margin as already reached', () => {
    const telemetry = withHistory([
      [0, 25],
      [30, 40],
    ])
    telemetry.readings = {
      extruder: reading({
        objectName: 'extruder',
        kind: 'extruder',
        temperature: 99.8,
        target: 100,
      }),
    }
    expect(telemetry.timeToTarget('extruder')).toBe(0)
  })

  it('gives no estimate when the rate is too small to trust', () => {
    const telemetry = withHistory([
      [0, 25],
      [30, 25.05],
    ])
    telemetry.readings = {
      extruder: reading({
        objectName: 'extruder',
        kind: 'extruder',
        temperature: 25.05,
        target: 100,
      }),
    }
    expect(telemetry.timeToTarget('extruder')).toBeNull()
  })

  it('gives no estimate when the temperature is moving away from the target', () => {
    const telemetry = withHistory([
      [0, 40],
      [30, 25],
    ])
    telemetry.readings = {
      extruder: reading({ objectName: 'extruder', kind: 'extruder', temperature: 25, target: 100 }),
    }
    expect(telemetry.timeToTarget('extruder')).toBeNull()
  })

  it('gives no estimate without an active target', () => {
    const telemetry = withHistory([
      [0, 25],
      [30, 40],
    ])
    telemetry.readings = {
      extruder: reading({ objectName: 'extruder', kind: 'extruder', temperature: 40, target: 0 }),
    }
    expect(telemetry.timeToTarget('extruder')).toBeNull()
  })
})

describe('heater stall detection', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('flags a heater that has not gained ground over the stall window', () => {
    const telemetry = useTelemetryStore()
    telemetry.temperatureHistory = [
      { eventtime: 0, values: { heater_bed: 90 } },
      { eventtime: 45, values: { heater_bed: 90.4 } },
    ]
    telemetry.readings = {
      heater_bed: reading({
        objectName: 'heater_bed',
        kind: 'bed',
        temperature: 90.4,
        target: 110,
      }),
    }
    expect(telemetry.isStalled('heater_bed')).toBe(true)
  })

  it('does not flag a heater that is climbing normally', () => {
    const telemetry = useTelemetryStore()
    telemetry.temperatureHistory = [
      { eventtime: 0, values: { heater_bed: 90 } },
      { eventtime: 45, values: { heater_bed: 100 } },
    ]
    telemetry.readings = {
      heater_bed: reading({
        objectName: 'heater_bed',
        kind: 'bed',
        temperature: 100,
        target: 110,
      }),
    }
    expect(telemetry.isStalled('heater_bed')).toBe(false)
  })

  it('does not flag a heater already close to its target', () => {
    const telemetry = useTelemetryStore()
    telemetry.temperatureHistory = [
      { eventtime: 0, values: { heater_bed: 108.5 } },
      { eventtime: 45, values: { heater_bed: 108.6 } },
    ]
    telemetry.readings = {
      heater_bed: reading({
        objectName: 'heater_bed',
        kind: 'bed',
        temperature: 108.6,
        target: 110,
      }),
    }
    expect(telemetry.isStalled('heater_bed')).toBe(false)
  })

  it('withholds a verdict until enough history has accumulated', () => {
    const telemetry = useTelemetryStore()
    telemetry.temperatureHistory = [
      { eventtime: 0, values: { heater_bed: 90 } },
      { eventtime: 10, values: { heater_bed: 90.1 } },
    ]
    telemetry.readings = {
      heater_bed: reading({
        objectName: 'heater_bed',
        kind: 'bed',
        temperature: 90.1,
        target: 110,
      }),
    }
    expect(telemetry.isStalled('heater_bed')).toBe(false)
  })
})

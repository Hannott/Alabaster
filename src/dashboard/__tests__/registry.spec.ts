import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { dashboardModuleRegistry } from '@/dashboard/registry'
import { useBedMeshStore } from '@/stores/bedMesh'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore, type SensorKind, type SensorReading } from '@/stores/telemetry'

function summaryFor(moduleId: string) {
  return dashboardModuleRegistry.find((definition) => definition.id === moduleId)?.summary
}

function sensorReading(
  objectName: string,
  kind: SensorKind,
  temperature: number,
  isSettable = false,
): SensorReading {
  return {
    objectName,
    name: objectName,
    kind,
    temperature,
    target: null,
    power: null,
    speed: null,
    isSettable,
  }
}

describe('dashboard module registry', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('summarizes a collapsed Print card with its progress, and only while printing', () => {
    const summary = summaryFor('print')
    const printer = usePrinterStore()

    // Idle: the application header already carries the printer's state, so the
    // collapsed card has nothing of its own to say.
    expect(summary?.({})).toBeNull()

    printer.printStats.state = 'printing'
    printer.virtualSdcard.progress = 0.423
    expect(summary?.({})).toBe('42%')

    printer.printStats.state = 'paused'
    expect(summary?.({})).toBe('42%')

    printer.printStats.state = 'complete'
    expect(summary?.({})).toBeNull()
  })

  it('reads the collapsed Print percentage the way that card is configured to read it', () => {
    const summary = summaryFor('print')
    const printer = usePrinterStore()
    printer.printStats.state = 'printing'
    printer.virtualSdcard.progress = 0.2
    printer.displayProgress = 0.8

    // A card left on the default source measures the file position, and one
    // pinned to the slicer measures M73 — the same two numbers the expanded
    // card would show. The header used to report the first regardless, so a
    // pinned card disagreed with itself between its own two states.
    expect(summary?.({})).toBe('20%')
    expect(summary?.({ estimateSource: 'slicer' })).toBe('80%')
    expect(summary?.({ useSlicerProgress: true })).toBe('80%')
  })

  /**
   * Whether the machine knows where it is, which is the precondition every
   * control on the Movement card shares. Never null: silence in this slot
   * reads as a card still loading rather than one correctly reporting a
   * printer that has not been homed.
   */
  it('summarizes a collapsed Movement card with its height, or says it is not homed', () => {
    const summary = summaryFor('movement')
    const printer = usePrinterStore()

    expect(summary?.({})).toBe('Not homed')

    // A partially homed machine still cannot vouch for a coordinate.
    printer.motion.homedAxes = 'xy'
    expect(summary?.({})).toBe('Not homed')

    printer.motion.homedAxes = 'xyz'
    printer.motion.livePosition = [10, 20, 4.25]
    printer.motion.homingOrigin = [0, 0, 0]
    expect(summary?.({})).toBe('Z 4.3')
  })

  it('tells a never-calibrated bed apart from one with an unloaded mesh, collapsed', () => {
    // Both look identical if either collapses to nothing — the second is
    // running unlevelled after having known better, which the header owes a
    // word to even collapsed. The full warning colour and icon live only in
    // the expanded card; this slot is plain text with no room for either.
    const summary = summaryFor('bedMesh')
    const bedMesh = useBedMeshStore()

    expect(summary?.({})).toBe('No data')

    bedMesh.profiles = ['default']
    expect(summary?.({})).toBe('Unloaded')

    bedMesh.profileName = 'default'
    bedMesh.probedMatrix = [
      [0.01, 0.02],
      [0.02, 0.03],
    ]
    expect(summary?.({})).toBe('Range: 0.020')
  })

  /*
   * The module whose entire job is "how hot is it" collapsed to nothing at all
   * until this existed. The fallback chain matters as much as the hotend does:
   * a machine with no extruder still has a heater or a sensor worth putting in
   * the header, and only a genuine absence of any reading collapses to null.
   */
  it('summarizes a collapsed Temperatures card with the hotend, falling back down the sensors', () => {
    const summary = summaryFor('temperatures')
    const telemetry = useTelemetryStore()

    expect(summary?.({})).toBeNull()

    telemetry.sensorObjects = ['heater_bed', 'temperature_sensor chamber']
    telemetry.readings = {
      heater_bed: sensorReading('heater_bed', 'bed', 59.6, true),
      'temperature_sensor chamber': sensorReading('temperature_sensor chamber', 'sensor', 31.2),
    }
    // No extruder: the first thing that can be heated speaks for the card.
    expect(summary?.({})).toBe('60°C')

    telemetry.sensorObjects = ['temperature_sensor chamber']
    telemetry.readings = {
      'temperature_sensor chamber': sensorReading('temperature_sensor chamber', 'sensor', 31.2),
    }
    // Nothing heatable at all, so the one thing it can measure is the reading.
    expect(summary?.({})).toBe('31°C')

    telemetry.sensorObjects = ['extruder', 'temperature_sensor chamber']
    telemetry.readings = {
      extruder: sensorReading('extruder', 'extruder', 213.4, true),
      'temperature_sensor chamber': sensorReading('temperature_sensor chamber', 'sensor', 31.2),
    }
    expect(summary?.({})).toBe('213°C')
  })

  /*
   * The module whose whole job is "is anything currently on" said nothing at
   * all collapsed, before this existed. No fan label in the string — a
   * fan's own name has no length limit and the header's does — so this
   * follows Temperatures' bare-reading convention rather than naming which
   * fan is reporting.
   */
  it('summarizes a collapsed Controls card with the part fan, falling back to the first controllable fan', () => {
    const summary = summaryFor('controls')
    const printerConfig = usePrinterConfigStore()
    const telemetry = useTelemetryStore()

    // No controllable fans configured at all.
    expect(summary?.({})).toBeNull()

    printerConfig.settings = { 'fan_generic aux_fan': {} }
    // Configured, but Klipper has not reported a speed yet.
    expect(summary?.({})).toBeNull()

    telemetry.fans = {
      'fan_generic aux_fan': { objectName: 'fan_generic aux_fan', speed: 0.3, rpm: null },
    }
    expect(summary?.({})).toBe('30%')

    // A part fan outranks any generic controllable fan once one is configured.
    printerConfig.settings = { fan: {}, 'fan_generic aux_fan': {} }
    telemetry.fans = {
      ...telemetry.fans,
      fan: { objectName: 'fan', speed: 0.42, rpm: null },
    }
    expect(summary?.({})).toBe('42%')
  })

  it('keeps every summary short enough to share the card header', () => {
    const printer = usePrinterStore()
    printer.printStats.state = 'printing'
    printer.virtualSdcard.progress = 1

    for (const definition of dashboardModuleRegistry) {
      const value = definition.summary?.({})
      if (value === undefined || value === null) continue
      expect(
        value.length,
        `${definition.id} summary is too long for the header`,
      ).toBeLessThanOrEqual(12)
    }
  })
})

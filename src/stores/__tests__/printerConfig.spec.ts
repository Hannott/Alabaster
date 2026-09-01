import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'

const settings = {
  printer: {
    max_velocity: 600,
    max_accel: 8000,
    square_corner_velocity: 5,
    minimum_cruise_ratio: 0,
  },
  extruder: {
    min_temp: 0,
    max_temp: 320,
    min_extrude_temp: 185,
    max_extrude_only_distance: 150,
    control: 'pid',
  },
  heater_bed: { min_temp: 0, max_temp: 120, control: 'watermark' },
  'heater_generic chamber': { min_temp: 0, max_temp: 90, control: 'mpc' },
  fan: {},
  'fan_generic exhaust': {},
  'heater_fan hotend_fan': {},
  'controller_fan sidepanel_fan': {},
  'output_pin interior_light': { pwm: true, scale: 1 },
  'output_pin probe_enable': { pwm: false, scale: 1 },
  bed_mesh: { probe_count: '7, 7' },
}

function mockQuery(result: unknown) {
  const moonraker = useMoonrakerStore()
  return vi.spyOn(moonraker, 'rpcCall').mockResolvedValue(result as never)
}

describe('printer configuration store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('answers capability questions from the reported configuration', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.hasSettings).toBe(true)
    expect(printerConfig.limitsFor('extruder')).toEqual({ minimum: 0, maximum: 320 })
    expect(printerConfig.limitsFor('heater_bed').maximum).toBe(120)
    expect(printerConfig.minExtrudeTemperature).toBe(185)
    expect(printerConfig.maxExtrudeDistance).toBe(150)
    expect(printerConfig.hasBedMesh).toBe(true)
    expect(printerConfig.motionLimits).toEqual({
      maxVelocity: 600,
      maxAccel: 8000,
      squareCornerVelocity: 5,
      minimumCruiseRatio: 0,
    })
  })

  it('reports each heater control scheme, so calibration offers the right command', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.controlKindFor('extruder')).toBe('pid')
    expect(printerConfig.controlKindFor('heater_bed')).toBe('watermark')
    expect(printerConfig.controlKindFor('heater_generic chamber')).toBe('mpc')
    expect(printerConfig.controlKindFor('temperature_sensor missing')).toBeNull()
  })

  it('offers only the leveling actions the machine is configured for', async () => {
    mockQuery({
      eventtime: 1,
      status: {
        configfile: {
          settings: { ...settings, quad_gantry_level: {}, screws_tilt_adjust: { screw1: '0,0' } },
        },
      },
    })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.levelingMethods).toEqual(['quadGantryLevel', 'screwsTiltAdjust'])
  })

  /**
   * Whether there is a probe at all, which is a different question from where it
   * sits: `probeOffset` answers zeroes for a machine with none, because a caller
   * drawing a probe point wants a number either way. This one gates a command
   * that does not exist without one.
   */
  it('tells a probe’s offset apart from whether there is a probe', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.hasProbe).toBe(false)
    expect(printerConfig.probeOffset).toEqual({ x: 0, y: 0 })

    mockQuery({
      eventtime: 1,
      status: {
        configfile: { settings: { ...settings, bltouch: { x_offset: -40, y_offset: -10 } } },
      },
    })
    await printerConfig.refresh()
    expect(printerConfig.hasProbe).toBe(true)
    expect(printerConfig.probeOffset).toEqual({ x: -40, y: -10 })
  })

  /**
   * `Z_OFFSET_APPLY_ENDSTOP` exists under exactly two conditions, and both are
   * read rather than inferred from "has no probe": a `[stepper_z]`
   * `position_endstop`, or delta kinematics, where the three towers are adjusted
   * together and there is no `[stepper_z]` section to read at all.
   */
  it('recognizes both machines that can write a Z endstop offset, and the one that cannot', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()
    expect(printerConfig.hasZEndstopOffset).toBe(false)

    mockQuery({
      eventtime: 1,
      status: { configfile: { settings: { ...settings, stepper_z: { position_endstop: 0.5 } } } },
    })
    await printerConfig.refresh()
    expect(printerConfig.hasZEndstopOffset).toBe(true)

    mockQuery({
      eventtime: 1,
      status: {
        configfile: { settings: { ...settings, printer: { kinematics: 'delta' } } },
      },
    })
    await printerConfig.refresh()
    expect(printerConfig.hasZEndstopOffset).toBe(true)
  })

  /**
   * Klipper's `bed_screws` object reports which screw it stands at as a bare
   * index and never sends the list, so the prompt can only name the screw by
   * reading the configuration that defined it. `screwN` runs until the first
   * gap, which is Klipper's own loop.
   */
  it('reads the bed screws in the order the helper visits them', async () => {
    mockQuery({
      eventtime: 1,
      status: {
        configfile: {
          settings: {
            ...settings,
            bed_screws: {
              screw1: [30, 30],
              screw1_name: 'front left',
              screw1_fine_adjust: [30, 30],
              screw2: [270, 30],
              // A gap: screw4 exists in the config and Klipper stops before it.
              screw4: [30, 270],
            },
          },
        },
      },
    })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.bedScrews).toEqual([
      { name: 'front left', x: 30, y: 30, hasFineAdjust: true },
      { name: null, x: 270, y: 30, hasFineAdjust: false },
    ])
  })

  it('reports no bed screws on a printer that declares none', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.bedScrews).toEqual([])
  })

  it('offers no leveling at all on a printer configured for none', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.levelingMethods).toEqual([])
  })

  it('discovers history_field_* declarations from any sensor section', async () => {
    mockQuery({
      eventtime: 1,
      status: {
        configfile: {
          settings: {
            ...settings,
            'sensor power_meter': {
              history_field_energy_wh: { desc: 'Energy used', units: 'Wh' },
              // Not a history field, and should be ignored.
              unrelated_option: 5,
            },
          },
        },
      },
    })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.historyFields).toEqual([
      {
        provider: 'sensor power_meter',
        field: 'energy_wh',
        description: 'Energy used',
        units: 'Wh',
      },
    ])
  })

  it('reports no history fields on a printer with no such sensor', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.historyFields).toEqual([])
  })

  it('separates fans an operator may drive from fans Klipper owns', async () => {
    mockQuery({ eventtime: 1, status: { configfile: { settings } } })
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.fans).toEqual([
      { objectName: 'fan', name: 'fan', kind: 'part' },
      { objectName: 'fan_generic exhaust', name: 'exhaust', kind: 'controllable' },
      { objectName: 'heater_fan hotend_fan', name: 'hotend_fan', kind: 'monitored' },
      { objectName: 'controller_fan sidepanel_fan', name: 'sidepanel_fan', kind: 'monitored' },
    ])
    expect(printerConfig.outputPins).toEqual([
      { objectName: 'output_pin interior_light', name: 'interior_light', isPwm: true, scale: 1 },
      { objectName: 'output_pin probe_enable', name: 'probe_enable', isPwm: false, scale: 1 },
    ])
  })

  it('falls back to safe defaults when the query fails', async () => {
    const moonraker = useMoonrakerStore()
    vi.spyOn(moonraker, 'rpcCall').mockRejectedValue(new Error('offline'))
    const printerConfig = usePrinterConfigStore()
    await printerConfig.refresh()

    expect(printerConfig.failed).toBe(true)
    expect(printerConfig.hasSettings).toBe(false)
    expect(printerConfig.fans).toEqual([])
    expect(printerConfig.limitsFor('extruder')).toEqual({ minimum: 0, maximum: 300 })
    expect(printerConfig.minExtrudeTemperature).toBe(170)
  })
})

import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { useAvailabilityStore } from '@/stores/availability'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'
import { isRecord } from '@/utils/records'

export interface HeaterLimits {
  minimum: number
  maximum: number
}

export type ConfiguredFanKind = 'part' | 'controllable' | 'monitored'

/** Klipper resolves `control` to one of these for every heater and temperature fan. */
export type HeaterControlKind = 'pid' | 'mpc' | 'watermark'

/**
 * Each is a distinct Klipper command with distinct hardware behind it, so the
 * card offers exactly the ones the machine is configured for rather than a
 * generic "level" button that might not apply.
 */
export type LevelingMethod =
  'quadGantryLevel' | 'zTilt' | 'screwsTiltAdjust' | 'bedScrews' | 'deltaCalibrate'

/**
 * Every section name a probe can be declared under. Shared by the two
 * questions that need it — where the probe sits, and whether there is one at
 * all — so a printer using one of the less common sections cannot be
 * recognised by one and missed by the other.
 */
const probeSections = [
  'probe',
  'bltouch',
  'smart_effector',
  'dockable_probe',
  'beacon',
  'cartographer',
  'scanner',
  'probe_eddy_current',
] as const

/** One screw from `[bed_screws]`, in the order `BED_SCREWS_ADJUST` visits them. */
export interface ConfiguredBedScrew {
  /** `screwN_name`, or null where the config gives none and the caller names it from the coordinate. */
  name: string | null
  x: number
  y: number
  /** Whether this screw is also visited on the second, finer pass. */
  hasFineAdjust: boolean
}

const levelingSections: ReadonlyArray<readonly [LevelingMethod, string]> = [
  ['quadGantryLevel', 'quad_gantry_level'],
  ['zTilt', 'z_tilt'],
  ['screwsTiltAdjust', 'screws_tilt_adjust'],
  ['bedScrews', 'bed_screws'],
  ['deltaCalibrate', 'delta_calibrate'],
]

export interface ConfiguredFan {
  objectName: string
  name: string
  kind: ConfiguredFanKind
}

export interface ConfiguredOutputPin {
  objectName: string
  name: string
  isPwm: boolean
  scale: number
}

export interface MotionLimits {
  maxVelocity: number | null
  maxAccel: number | null
  squareCornerVelocity: number | null
  minimumCruiseRatio: number | null
}

/**
 * One `history_field_*` entry a `[sensor ...]` section has declared, which
 * Moonraker then records against every job. `provider` is the section's own
 * name, matching what `server.history.totals`'s `auxiliary_totals` reports —
 * that response carries no description or unit of its own, only the field and
 * a number, so this is the only place either can be recovered for it.
 */
export interface HistoryFieldDeclaration {
  provider: string
  field: string
  description: string
  units: string | null
}

const historyFieldPrefix = 'history_field_'

const defaultHeaterLimits: HeaterLimits = { minimum: 0, maximum: 300 }

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sectionName(section: string): string {
  const separatorIndex = section.indexOf(' ')
  return separatorIndex < 0 ? section : section.slice(separatorIndex + 1).trim()
}

/**
 * Klipper only reports configured limits and hardware through
 * `configfile.settings`, so capability questions — which fans can be driven,
 * how hot a heater may run, when the extruder accepts motion — are answered
 * here instead of being guessed by each module.
 */
export const usePrinterConfigStore = defineStore('printerConfig', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const settings = ref<Record<string, unknown>>({})
  const hasSettings = ref(false)
  const isLoading = ref(false)
  const failed = ref(false)
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  const load = createGuardedLoad({ isLoading, failed })

  function section(name: string): Record<string, unknown> | null {
    const value = settings.value[name.toLowerCase()]
    return isRecord(value) ? value : null
  }

  function sectionsWithPrefix(prefix: string): Array<[string, Record<string, unknown>]> {
    return Object.entries(settings.value)
      .filter(([name]) => name === prefix || name.startsWith(`${prefix} `))
      .flatMap(([name, value]) => (isRecord(value) ? [[name, value] as const] : []))
      .map(([name, value]) => [name, value])
  }

  const heaterLimits = computed(() => {
    const limits = new Map<string, HeaterLimits>()
    for (const prefix of ['extruder', 'heater_bed', 'heater_generic', 'temperature_fan']) {
      for (const [name, values] of sectionsWithPrefix(prefix)) {
        limits.set(name, {
          minimum: finiteNumber(values.min_temp) ?? defaultHeaterLimits.minimum,
          maximum: finiteNumber(values.max_temp) ?? defaultHeaterLimits.maximum,
        })
      }
    }
    return limits
  })

  const fans = computed<ConfiguredFan[]>(() => {
    const configured: ConfiguredFan[] = []
    if (section('fan')) {
      configured.push({ objectName: 'fan', name: 'fan', kind: 'part' })
    }
    for (const [name] of sectionsWithPrefix('fan_generic')) {
      configured.push({ objectName: name, name: sectionName(name), kind: 'controllable' })
    }
    for (const prefix of ['heater_fan', 'controller_fan']) {
      for (const [name] of sectionsWithPrefix(prefix)) {
        configured.push({ objectName: name, name: sectionName(name), kind: 'monitored' })
      }
    }
    return configured
  })

  const outputPins = computed<ConfiguredOutputPin[]>(() =>
    sectionsWithPrefix('output_pin').map(([name, values]) => ({
      objectName: name,
      name: sectionName(name),
      isPwm: values.pwm === true,
      scale: finiteNumber(values.scale) ?? 1,
    })),
  )

  const motionLimits = computed<MotionLimits>(() => {
    const printer = section('printer')
    return {
      maxVelocity: finiteNumber(printer?.max_velocity),
      maxAccel: finiteNumber(printer?.max_accel),
      squareCornerVelocity: finiteNumber(printer?.square_corner_velocity),
      minimumCruiseRatio: finiteNumber(printer?.minimum_cruise_ratio),
    }
  })

  const minExtrudeTemperature = computed(
    () => finiteNumber(section('extruder')?.min_extrude_temp) ?? 170,
  )
  const maxExtrudeDistance = computed(
    () => finiteNumber(section('extruder')?.max_extrude_only_distance) ?? 50,
  )
  /**
   * The whole `[extruder]` section as Klipper resolved it, for the one question
   * this store cannot answer on the caller's behalf: which pressure-advance
   * settings this firmware has. That is a set rather than a value — mainline
   * reports two keys, Kalico's non-linear model reports seven — and the
   * judgement about what to do with them belongs with the card, exactly as
   * `heaterSettingsFor` leaves the heat model to decide which heater values
   * matter.
   *
   * Deliberately not a `isKalico` boolean. A capability is discovered from what
   * the machine reports, never from what it calls itself, and a boolean here
   * would be the shape that invites a firmware branch later.
   *
   * Kept current by `refresh()` on Klipper ready, which is exactly when a
   * changed `printer.cfg` takes effect — there is no notification for a config
   * value because a config value cannot change without the restart that fires
   * this.
   */
  const extruderSettings = computed(() => section('extruder'))
  /*
   * The extruder geometry the G-code viewer needs to draw beads at their real
   * size. Both come from the machine rather than from a viewer setting, because
   * the machine already knows them: filament diameter in particular is squared
   * when recovering a bead's width from the extruded volume, so assuming
   * 1.75 mm on a 2.85 mm machine understates every bead by about two and a half
   * times. Nulls mean the printer has not reported a value, and the caller
   * supplies its own default.
   */
  const extruderGeometry = computed(() => {
    const values = section('extruder')
    return {
      nozzleDiameter: finiteNumber(values?.nozzle_diameter) ?? null,
      filamentDiameter: finiteNumber(values?.filament_diameter) ?? null,
    }
  })
  const hasBedMesh = computed(() => section('bed_mesh') !== null)

  /*
   * Where the probe sits relative to the nozzle, from whichever probe section
   * this machine defines. Exposed as the offset rather than the section, so a
   * caller needing "where is the probe" does not have to know which of eight
   * section names its printer happens to use.
   */
  const probeOffset = computed(() => {
    for (const name of probeSections) {
      const values = section(name)
      if (!values) continue
      return { x: finiteNumber(values.x_offset) ?? 0, y: finiteNumber(values.y_offset) ?? 0 }
    }
    return { x: 0, y: 0 }
  })

  /**
   * Whether this machine has a probe at all, which is a different question from
   * where it sits: `probeOffset` answers with zeroes for a printer that has
   * none, because a caller drawing a probe point wants a number either way.
   *
   * This one gates a command. Klipper registers `Z_OFFSET_APPLY_PROBE` from the
   * probe object itself, so on a machine with no probe section the command does
   * not exist and sending it is an "Unknown command" error rather than a
   * refusal — which is why Movement asks this before offering to fold a
   * babystepped offset into anything. See `hasZEndstopOffset` for the other
   * half of that decision.
   */
  const hasProbe = computed(() => probeSections.some((name) => section(name) !== null))

  /**
   * Whether `Z_OFFSET_APPLY_ENDSTOP` exists — the probe-less machine's
   * equivalent, which writes the offset into the Z endstop position instead of
   * into a probe's `z_offset`.
   *
   * Klipper registers it under exactly two conditions, both read here rather
   * than assumed from "has no probe": `[stepper_z]` declaring a
   * `position_endstop` (the Cartesian with a physical Z endstop), or delta
   * kinematics, where the three towers' endstops are adjusted together. A
   * printer with neither — a CoreXY whose Z endstop *is* its probe, configured
   * as `probe:z_virtual_endstop` with no probe section Alabaster recognises —
   * has no way to make a babystepped offset permanent, and the honest answer
   * there is to offer nothing rather than a button that errors.
   */
  const hasZEndstopOffset = computed(() => {
    if (finiteNumber(section('stepper_z')?.position_endstop) !== null) return true
    return section('printer')?.kinematics === 'delta'
  })

  /**
   * The screws `BED_SCREWS_ADJUST` will visit, in the order it visits them.
   *
   * Klipper's `bed_screws` object reports which screw it is standing at as a
   * bare index into this list and never reports the list itself, so the only
   * way a prompt can say *which* screw — or how many are left — is to read the
   * configuration that defined them. `screwN` runs from 1 until the first gap,
   * which is Klipper's own loop, and a screw with a `screwN_fine_adjust`
   * coordinate is also visited on the second, finer pass.
   *
   * The name is left null where the config does not give one: Klipper's own
   * fallback is the coordinate pair, and formatting that belongs to the surface
   * that has the locale rather than to this store.
   */
  const bedScrews = computed<ConfiguredBedScrew[]>(() => {
    const values = section('bed_screws')
    if (!values) return []
    const screws: ConfiguredBedScrew[] = []
    for (let index = 1; index < 100; index += 1) {
      const coordinate = values[`screw${index}`]
      if (!Array.isArray(coordinate)) break
      const name = values[`screw${index}_name`]
      screws.push({
        name: typeof name === 'string' && name.trim() !== '' ? name : null,
        x: finiteNumber(coordinate[0]) ?? 0,
        y: finiteNumber(coordinate[1]) ?? 0,
        hasFineAdjust: Array.isArray(values[`screw${index}_fine_adjust`]),
      })
    }
    return screws
  })

  /**
   * Only the leveling actions this machine can actually run. A gantry printer
   * reports `quad_gantry_level`, a bedslinger `screws_tilt_adjust`, and a
   * printer with neither gets no leveling row at all.
   */
  /**
   * Every `history_field_*` any `[sensor ...]` section declares — a Moonraker
   * component, not a Klipper one, so it lives beside the other section scans
   * rather than in a fixed list. A printer with no such sensor reports none,
   * which is the gate History's auxiliary rows render against.
   */
  const historyFields = computed<HistoryFieldDeclaration[]>(() => {
    const declarations: HistoryFieldDeclaration[] = []
    for (const [provider, values] of sectionsWithPrefix('sensor')) {
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith(historyFieldPrefix) || !isRecord(value)) continue
        const field = key.slice(historyFieldPrefix.length)
        declarations.push({
          provider,
          field,
          description: typeof value.desc === 'string' ? value.desc : field,
          units: typeof value.units === 'string' ? value.units : null,
        })
      }
    }
    return declarations
  })

  const levelingMethods = computed<LevelingMethod[]>(() =>
    levelingSections
      .filter(([, sectionName]) => section(sectionName) !== null)
      .map(([method]) => method),
  )

  /**
   * Whether the loaded configuration declares this section. The discovery gate a
   * navigation destination or a module asks, so a section name is declared in one
   * table rather than hard-coded at each call site.
   */
  function hasSection(name: string): boolean {
    return section(name) !== null
  }

  function limitsFor(objectName: string): HeaterLimits {
    return heaterLimits.value.get(objectName) ?? defaultHeaterLimits
  }

  /**
   * PID and MPC calibration only apply to a heater configured for that control
   * scheme; a `watermark` (bang-bang) heater has no constants to calibrate.
   * `configfile.settings` reports the resolved value even when the section
   * left `control` at its default, so this needs no separate discovery step.
   */
  /**
   * The raw configuration Klipper reports for one heater. Exposed so the heat
   * model can fingerprint a heater's control behaviour without this store
   * having to know which of those values matter — that judgement belongs with
   * the model, and it differs between PID and MPC.
   */
  function heaterSettingsFor(objectName: string): Record<string, unknown> | null {
    return section(objectName)
  }

  /** `max_power` scales every climb, whichever control scheme is in use. */
  function maximumPowerFor(objectName: string): number {
    const power = finiteNumber(section(objectName)?.max_power)
    return power !== null && power > 0 ? power : 1
  }

  function controlKindFor(objectName: string): HeaterControlKind | null {
    const control = section(objectName)?.control
    return control === 'pid' || control === 'mpc' || control === 'watermark' ? control : null
  }

  async function refresh(): Promise<void> {
    await load.run(
      () =>
        moonraker.rpcCall('printer.objects.query', {
          objects: { configfile: ['settings'] },
        }),
      (result) => {
        const configfile = result.status.configfile
        const values = isRecord(configfile) ? configfile.settings : null
        if (!isRecord(values)) {
          failed.value = true
          return
        }
        settings.value = values
        hasSettings.value = true
      },
    )
  }

  /**
   * The config sections describe one machine, and they gate capability
   * discovery — which fans, heaters and leveling methods every module offers —
   * so the old machine's sections advertising themselves as the new one's is
   * the worst kind of stale data. Wiped on the switch; the availability watch
   * below re-reads once the new printer reports ready.
   */
  function printerChanged(): void {
    load.invalidate()
    settings.value = {}
    hasSettings.value = false
    failed.value = false
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isKlipperReady,
      (isReady) => {
        if (isReady) void refresh()
      },
      { immediate: true },
    )
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    settings,
    hasSettings,
    isLoading,
    failed,
    heaterLimits,
    fans,
    outputPins,
    motionLimits,
    minExtrudeTemperature,
    maxExtrudeDistance,
    extruderSettings,
    extruderGeometry,
    hasBedMesh,
    hasSection,
    section,
    probeOffset,
    hasProbe,
    hasZEndstopOffset,
    bedScrews,
    historyFields,
    levelingMethods,
    limitsFor,
    controlKindFor,
    heaterSettingsFor,
    maximumPowerFor,
    refresh,
    start,
    stop,
  }
})

/**
 * The unit a Klipper option is measured in, for the options common enough to
 * be worth naming.
 *
 * Shipped rather than typed by the user: a unit typed once when pinning a
 * field is then shown beside the value as fact, including when it is wrong.
 * An option missing from this table shows no unit rather than a guessed one.
 * The result is a locale key under `configuration.quickConfig.units`, so the
 * unit is translated like every other string.
 */
export type OptionUnit =
  'millimetres' | 'mmPerSecond' | 'mmPerSecondSquared' | 'seconds' | 'hertz' | 'degreesCelsius'

const temperatureLimits: Record<string, OptionUnit> = {
  min_temp: 'degreesCelsius',
  max_temp: 'degreesCelsius',
}

const probeOptions: Record<string, OptionUnit> = {
  x_offset: 'millimetres',
  y_offset: 'millimetres',
  z_offset: 'millimetres',
  speed: 'mmPerSecond',
  lift_speed: 'mmPerSecond',
  sample_retract_dist: 'millimetres',
  samples_tolerance: 'millimetres',
}

const levelingOptions: Record<string, OptionUnit> = {
  retry_tolerance: 'millimetres',
  speed: 'mmPerSecond',
  horizontal_move_z: 'millimetres',
}

/** Keyed by section type: the section name up to its first space. */
const unitsBySectionType: Record<string, Record<string, OptionUnit>> = {
  printer: {
    max_velocity: 'mmPerSecond',
    max_accel: 'mmPerSecondSquared',
    max_accel_to_decel: 'mmPerSecondSquared',
    square_corner_velocity: 'mmPerSecond',
    max_z_velocity: 'mmPerSecond',
    max_z_accel: 'mmPerSecondSquared',
  },
  bed_mesh: {
    mesh_min: 'millimetres',
    mesh_max: 'millimetres',
    mesh_radius: 'millimetres',
    speed: 'mmPerSecond',
    horizontal_move_z: 'millimetres',
    fade_start: 'millimetres',
    fade_end: 'millimetres',
    fade_target: 'millimetres',
  },
  z_tilt: levelingOptions,
  quad_gantry_level: levelingOptions,
  input_shaper: {
    shaper_freq_x: 'hertz',
    shaper_freq_y: 'hertz',
    shaper_freq_z: 'hertz',
  },
  extruder: {
    pressure_advance_smooth_time: 'seconds',
    rotation_distance: 'millimetres',
    nozzle_diameter: 'millimetres',
    filament_diameter: 'millimetres',
    max_extrude_only_velocity: 'mmPerSecond',
    max_extrude_only_accel: 'mmPerSecondSquared',
    instantaneous_corner_velocity: 'mmPerSecond',
    min_extrude_temp: 'degreesCelsius',
    ...temperatureLimits,
  },
  heater_bed: temperatureLimits,
  heater_generic: temperatureLimits,
  temperature_fan: temperatureLimits,
  firmware_retraction: {
    retract_length: 'millimetres',
    unretract_extra_length: 'millimetres',
    retract_speed: 'mmPerSecond',
    unretract_speed: 'mmPerSecond',
  },
  probe: probeOptions,
  bltouch: probeOptions,
  smart_effector: probeOptions,
  dockable_probe: probeOptions,
  safe_z_home: {
    z_hop: 'millimetres',
    z_hop_speed: 'mmPerSecond',
    speed: 'mmPerSecond',
  },
  stepper: {
    rotation_distance: 'millimetres',
    position_min: 'millimetres',
    position_max: 'millimetres',
    position_endstop: 'millimetres',
    homing_speed: 'mmPerSecond',
    second_homing_speed: 'mmPerSecond',
    homing_retract_dist: 'millimetres',
  },
}

function sectionType(section: string): string {
  const type = section.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  // `extruder1`… share the primary extruder's options; `stepper_x`, `stepper_z1`… share one table.
  if (/^extruder\d*$/.test(type)) return 'extruder'
  if (type.startsWith('stepper_')) return 'stepper'
  return type
}

export function optionUnit(section: string, option: string): OptionUnit | null {
  return unitsBySectionType[sectionType(section)]?.[option.toLowerCase()] ?? null
}

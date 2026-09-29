import { describe, expect, it } from 'vitest'

import {
  calibrationProcedures,
  initialProcedure,
  initialProcedureValues,
  isProcedureStale,
  missingProcedureValues,
  parseAccelerometer,
  parseAxesMap,
  parseAxesNoise,
  parseBedMesh,
  parseBedTilt,
  parseBelts,
  parseVibrations,
  rowsFromPendingItems,
  parseEndstopPhase,
  parsePid,
  parsePositionEndstop,
  parseProbeAccuracy,
  parseRetries,
  parseScrews,
  parseScrewsStatus,
  parseShakeTuneShaper,
  parseShaperCalibrate,
  parseZOffset,
  procedureById,
  shakeTuneShaperActionsFromRows,
  proceduresForStage,
  type ProcedureContext,
} from '@/features/calibration/procedures'

function context(
  overrides: Partial<ProcedureContext> & { sections?: string[] } = {},
): ProcedureContext {
  const sections = overrides.sections ?? []
  const settings: Record<string, Record<string, unknown>> = {}
  for (const section of sections) settings[section] = {}
  return {
    hasSection: (name) => sections.includes(name),
    sections,
    hasCommand: () => false,
    hasMacro: () => false,
    settings: (section) => settings[section] ?? null,
    kinematics: 'cartesian',
    hasProbe: false,
    heaters: [],
    hasRunoutSensors: false,
    livePressureAdvance: null,
    liveSmoothTime: null,
    pendingItems: () => ({}),
    mesh: () => null,
    newestGraph: () => null,
    screwsTilt: () => null,
    ...overrides,
  }
}

function ids(stage: Parameters<typeof proceduresForStage>[0], ctx: ProcedureContext): string[] {
  return proceduresForStage(stage, ctx).map((procedure) => procedure.id)
}

describe('the procedure registry', () => {
  it('gives every procedure a unique id', () => {
    const all = calibrationProcedures.map((procedure) => procedure.id)
    expect(new Set(all).size).toBe(all.length)
  })

  /*
   * The rule the registry exists for: an entry that cannot say what it found
   * is a button. Only the panels, which are their own result, may go without.
   */
  it('gives every command procedure both a builder and a parser', () => {
    for (const procedure of calibrationProcedures) {
      if (procedure.panel) continue
      expect(procedure.build, procedure.id).toBeTypeOf('function')
      expect(procedure.parse, procedure.id).toBeTypeOf('function')
    }
  })

  it('offers only what the printer has', () => {
    expect(ids('axes', context())).toEqual(['endstops'])
    expect(ids('bed', context({ sections: ['bed_mesh', 'quad_gantry_level'] }))).toEqual([
      'bedMesh',
      'quadGantryLevel',
    ])
  })

  it('offers plugin procedures only where the plugin registered its command', () => {
    const withBeacon = context({ hasCommand: (command) => command === 'BEACON_CALIBRATE' })
    expect(ids('bed', withBeacon)).toContain('beacon')
    expect(ids('bed', context())).not.toContain('beacon')
  })

  it('offers the belt comparison only on CoreXY and CoreXZ', () => {
    const macros = { hasMacro: (name: string) => name === 'COMPARE_BELTS_RESPONSES' }
    expect(ids('resonance', context({ ...macros, kinematics: 'corexy' }))).toContain(
      'shakeTuneBelts',
    )
    expect(ids('resonance', context({ ...macros, kinematics: 'cartesian' }))).not.toContain(
      'shakeTuneBelts',
    )
  })

  it('offers the Z endstop test only where Z has a switch of its own', () => {
    const withSwitch = context({
      sections: ['stepper_z'],
      settings: (section) => (section === 'stepper_z' ? { endstop_pin: '^PG10' } : null),
    })
    const withProbe = context({
      sections: ['stepper_z'],
      settings: (section) =>
        section === 'stepper_z' ? { endstop_pin: 'probe:z_virtual_endstop' } : null,
    })
    expect(ids('axes', withSwitch)).toContain('zEndstop')
    expect(ids('axes', withProbe)).not.toContain('zEndstop')
  })
})

describe('building commands', () => {
  it('builds a mesh with a profile and a probe count, and nothing else', () => {
    const mesh = procedureById('bedMesh')!
    expect(mesh.build!({ PROFILE: '', PROBE_COUNT: '' }, context())).toBe('BED_MESH_CALIBRATE')
    expect(mesh.build!({ PROFILE: 'hot', PROBE_COUNT: '7, 7' }, context())).toBe(
      'BED_MESH_CALIBRATE PROFILE="hot" PROBE_COUNT=7,7',
    )
  })

  it('refuses a value that could smuggle another command onto the line', () => {
    expect(procedureById('bedMesh')!.build!({ PROFILE: 'a" \nG28' }, context())).toBeNull()
    expect(
      procedureById('stepperBuzz')!.build!({ STEPPER: 'stepper_x\nM112' }, context()),
    ).toBeNull()
  })

  it('picks PID or MPC by what the heater is configured for', () => {
    const heaters = [
      { objectName: 'extruder', label: 'Hotend', kind: 'mpc' as const },
      { objectName: 'heater_generic chamber', label: 'chamber', kind: 'pid' as const },
    ]
    const heaterModel = procedureById('heaterModel')!
    expect(heaterModel.build!({ HEATER: 'extruder', TARGET: '215' }, context({ heaters }))).toBe(
      'MPC_CALIBRATE HEATER=extruder TARGET=215',
    )
    expect(
      heaterModel.build!({ HEATER: 'heater_generic chamber', TARGET: '50' }, context({ heaters })),
    ).toBe('PID_CALIBRATE HEATER=chamber TARGET=50')
  })

  it('reports required values left empty', () => {
    expect(
      missingProcedureValues(procedureById('heaterModel')!, { HEATER: 'extruder', TARGET: '' }),
    ).toEqual(['TARGET'])
  })

  it('sends pressure advance only with a value to send', () => {
    const pressure = procedureById('pressureAdvance')!
    expect(pressure.build!({ ADVANCE: '', SMOOTH_TIME: '' }, context())).toBeNull()
    expect(pressure.build!({ ADVANCE: '0.045', SMOOTH_TIME: '' }, context())).toBe(
      'SET_PRESSURE_ADVANCE ADVANCE=0.045',
    )
  })

  it('offers nonlinear towers only with pa_test and RUN_PA_TEST, and hides linear PA under a model', () => {
    const extruder = { pressure_advance_model: 'recipr', linear_advance: 0 }
    const nonlinear = (hasMacro: boolean) =>
      context({
        sections: ['extruder', 'pa_test'],
        hasMacro: (name) => hasMacro && name === 'RUN_PA_TEST',
        settings: (section) =>
          section === 'extruder' ? extruder : section === 'pa_test' ? {} : null,
      })
    expect(ids('extrusion', nonlinear(true))).toContain('nonlinearPressureAdvance')
    expect(ids('extrusion', nonlinear(true))).not.toContain('pressureAdvance')
    expect(ids('extrusion', nonlinear(false))).not.toContain('nonlinearPressureAdvance')
    expect(ids('extrusion', context({ sections: ['extruder'] }))).toContain('pressureAdvance')
  })
})

describe('reading results', () => {
  it('reads the probe z_offset against the one it replaces', () => {
    const result = parseZOffset(
      ['// probe: z_offset: 1.535\nThe SAVE_CONFIG command will update the printer config file'],
      { z_offset: '1.4' },
    )
    expect(result).toEqual({
      rows: [{ label: { literal: 'z_offset' }, before: '1.4', after: '1.535' }],
      outcome: 'staged',
    })
  })

  it('reads the Z endstop position', () => {
    expect(
      parsePositionEndstop(['// stepper_z: position_endstop: 0.620'], {})?.rows[0]?.after,
    ).toBe('0.620')
  })

  it('reads the last retry line of a levelling run', () => {
    const result = parseRetries([
      '// Retries: 0/5 Probed points range: 0.035000 tolerance: 0.007500',
      '// Retries: 1/5 Probed points range: 0.004100 tolerance: 0.007500',
    ])
    expect(result?.rows.map((row) => row.after)).toEqual(['1/5', '0.004100', '0.007500'])
    expect(result?.outcome).toBe('applied')
  })

  it('reads each screw adjustment, with the base screw unadjusted', () => {
    const result = parseScrews([
      '// front left screw (base) : x=-5.0, y=30.0, z=2.48750',
      '// front right screw : x=155.0, y=30.0, z=2.36000 : adjust CW 01:15',
    ])
    expect(result?.rows).toEqual([
      { label: { literal: 'front left screw' }, after: '' },
      { label: { literal: 'front right screw' }, after: 'CW 01:15' },
    ])
  })

  it('reads PID constants against the heater’s current ones', () => {
    const result = parsePid(['// PID parameters: pid_Kp=22.200 pid_Ki=1.080 pid_Kd=114.000'], {
      pid_kp: '21.5',
    })
    expect(result?.rows[0]).toEqual({
      label: { literal: 'pid_Kp' },
      before: '21.5',
      after: '22.200',
    })
    expect(result?.outcome).toBe('staged')
  })

  it('reads an MPC model as its measured values', () => {
    const result = parsePid(
      ['// Finished MPC calibration', '// block_heat_capacity=16.2 sensor_responsiveness: 0.12'],
      {},
    )
    expect(result?.rows.map((row) => row.after)).toEqual(['16.2', '0.12'])
  })

  it('reads Klipper’s shaper recommendation per axis, with its max_accel and an apply action', () => {
    const result = parseShaperCalibrate(
      [
        "// To avoid too much smoothing with 'mzv', suggested max_accel <= 7000 mm/sec^2",
        '// Recommended shaper_type_x = mzv, shaper_freq_x = 53.8 Hz',
      ],
      { shaper_type_x: 'ei', shaper_freq_x: '50.2', max_accel: '5000' },
    )
    expect(result?.rows).toEqual([
      { label: { literal: 'shaper_type_x' }, before: 'ei', after: 'mzv' },
      { label: { literal: 'shaper_freq_x' }, before: '50.2', after: '53.8' },
      {
        label: { key: 'calibration.result.suggestedMaxAccel', params: { axis: 'X' } },
        before: '5000',
        after: '7000',
      },
    ])
    expect(result?.actions?.[0]).toMatchObject({
      kind: 'gcode',
      command: 'SET_INPUT_SHAPER SHAPER_TYPE_X=mzv SHAPER_FREQ_X=53.8',
    })
  })

  it('reads Shake&Tune’s recommendation from the run’s own output', () => {
    const result = parseShakeTuneShaper([
      '// Y axis frequency profile generation...',
      '//     -> Best shaper: ZV @ 39.6 Hz',
    ])
    expect(result?.rows[0]?.after).toBe('zv @ 39.6 Hz')
    expect(result?.actions).toEqual([
      expect.objectContaining({
        kind: 'gcode',
        command: 'SET_INPUT_SHAPER SHAPER_TYPE_Y=zv SHAPER_FREQ_Y=39.6',
      }),
      expect.objectContaining({
        kind: 'persist',
        section: 'input_shaper',
        restart: true,
        changes: [
          { option: 'shaper_type_y', value: 'zv' },
          { option: 'shaper_freq_y', value: '39.6' },
        ],
      }),
    ])
  })

  it('rebuilds a logged Shake&Tune run’s actions from its rows', () => {
    const actions = shakeTuneShaperActionsFromRows([
      {
        label: { key: 'calibration.result.shaperKind.best', params: { axis: 'X' } },
        after: 'smooth_zv @ 68.2 Hz',
      },
      {
        label: { key: 'calibration.result.shaperKind.lowVibrations', params: { axis: 'Y' } },
        after: 'ei @ 40 Hz',
      },
      { label: { literal: 'noise' }, after: '12' },
    ])
    expect(actions.map((action) => action.id)).toEqual(['apply-shaper', 'save-shaper'])
    expect(actions[0]).toMatchObject({
      command: 'SET_INPUT_SHAPER SHAPER_TYPE_X=smooth_zv SHAPER_FREQ_X=68.2',
    })
  })

  it('reads the accelerometer’s one sample', () => {
    const result = parseAccelerometer([
      '// accelerometer values (x, y, z): 470.7192, 941.4384, 9728.1968',
    ])
    expect(result?.rows.map((row) => row.after)).toEqual(['470.7192', '941.4384', '9728.1968'])
  })

  it('reads a noise line per accelerometer chip', () => {
    const result = parseAxesNoise([
      '// Axes noise for xy-axis accelerometer: 57.8 (x), 55.5 (y), 64.9 (z)',
      '// Axes noise for z-axis accelerometer: 12.0 (x), 11.1 (y), 13.2 (z)',
    ])
    expect(result?.rows).toHaveLength(2)
  })

  it('reads Shake&Tune’s detected axes_map and offers to write it to the chip’s section', () => {
    const result = parseAxesMap(
      [
        '// Note: An existing axes_map (x, -y, -z) was detected and temporarily deactivated for analysis',
        '// Machine axis X -> -x (angle error: 4.7 degrees)',
        '// ==> Detected axes_map: -x, -z, -y',
        "// Your current axes_map doesn't match! Please update your configuration to -x,-z,-y.",
      ],
      { accel_chip: 'adxl345', axes_map: '' },
    )
    expect(result?.rows).toEqual([
      { label: { literal: 'axes_map' }, before: 'x,-y,-z', after: '-x,-z,-y' },
    ])
    expect(result?.actions).toEqual([
      expect.objectContaining({
        kind: 'persist',
        section: 'adxl345',
        changes: [{ option: 'axes_map', value: '-x,-z,-y' }],
      }),
    ])
  })

  it('offers no axes_map write when it already matches or the chip is unknown', () => {
    const lines = ['// ==> Detected axes_map: -x, -z, -y']
    expect(parseAxesMap(lines, { accel_chip: 'adxl345', axes_map: '-x, -z, -y' })?.actions).toEqual(
      [],
    )
    expect(parseAxesMap(lines, { accel_chip: '', axes_map: '' })?.actions).toEqual([])
  })

  it('snapshots the accelerometer resonance_tester names and its current axes_map', () => {
    const procedure = procedureById('axesMap')!
    const ctx = context({
      sections: ['adxl345', 'adxl345 bed', 'resonance_tester'],
      settings: (section) =>
        section === 'resonance_tester'
          ? { accel_chip: 'adxl345 bed' }
          : section === 'adxl345 bed'
            ? { axes_map: ['x', '-y', '-z'] }
            : {},
    })
    expect(procedure.snapshot!({}, ctx)).toEqual({
      accel_chip: 'adxl345 bed',
      axes_map: 'x, -y, -z',
    })
  })

  it('reads probe accuracy statistics', () => {
    const result = parseProbeAccuracy([
      '// probe accuracy results: maximum 1.234000, minimum 1.100000, range 0.134000, average 1.167000, median 1.170000, standard deviation 0.045000',
    ])
    expect(result?.rows.at(-1)?.after).toBe('0.045000')
  })

  it('reads bed tilt and endstop phase', () => {
    expect(
      parseBedTilt(['// x_adjust: 0.000123 y_adjust: -0.000321 z_adjust: 0.010000'], {})?.rows,
    ).toHaveLength(3)
    expect(parseEndstopPhase(['// stepper_z: trigger_phase=12/64'])?.rows[0]?.after).toBe('12/64')
  })

  it('says a run staged something when Klipper mentions SAVE_CONFIG, and nothing before output arrives', () => {
    const buzz = procedureById('deltaCalibrate')!
    expect(buzz.parse!([], {}, {}, context())).toBeNull()
    expect(
      buzz.parse!(
        ['// The SAVE_CONFIG command will update the printer config file'],
        {},
        {},
        context(),
      )?.outcome,
    ).toBe('staged')
  })
})

describe('what a run staged', () => {
  const settings = (section: string) =>
    section === 'printer'
      ? { delta_radius: 140 }
      : section === 'stepper_a'
        ? { angle: 210, position_endstop: 297.5 }
        : null

  it('lists every option new or changed since the run started, against the file', () => {
    const before = { printer: { delta_radius: '140.000' }, 'bed_mesh old': { points: '1\n2' } }
    const after = {
      printer: { delta_radius: '140.612' },
      stepper_a: { angle: '210.184', position_endstop: '297.5' },
      'bed_mesh old': { points: '1\n2' },
    }
    expect(rowsFromPendingItems(before, after, settings)).toEqual([
      { label: { literal: 'printer · delta_radius' }, before: '140', after: '140.612' },
      { label: { literal: 'stepper_a · angle' }, before: '210', after: '210.184' },
      { label: { literal: 'stepper_a · position_endstop' }, before: '297.5', after: '297.5' },
    ])
  })

  it('leaves out a multi-line value, which is data rather than a number to compare', () => {
    const after = { 'bed_mesh default': { points: '0.1, 0.2\n0.3, 0.4', version: '1' } }
    expect(rowsFromPendingItems({}, after, settings)).toEqual([
      { label: { literal: 'bed_mesh default · version' }, before: null, after: '1' },
    ])
  })
})

describe('reading a mesh, a belt comparison and a vibration profile', () => {
  it('reads the mesh from the map beside it, against the profile that was loaded', () => {
    const ctx = context({
      mesh: () => ({ profile: 'hot', range: 0.1214, points: 25, temperature: 60.4 }),
    })
    const result = parseBedMesh(['// done'], { profile: 'default', range: '0.144 mm' }, {}, ctx)
    expect(result?.outcome).toBe('staged')
    expect(result?.rows).toEqual([
      { label: { key: 'calibration.result.profile' }, before: 'default', after: 'hot' },
      { label: { key: 'calibration.result.range' }, before: '0.144 mm', after: '0.121 mm' },
      { label: { key: 'calibration.result.points' }, after: '25' },
      { label: { key: 'calibration.result.bedTemperature' }, after: '60 °C' },
    ])
    expect(parseBedMesh([], {}, {}, ctx)).toBeNull()
    expect(parseBedMesh(['// done'], {}, {}, context())?.rows).toEqual([])
  })

  it('snapshots the loaded mesh a calibration replaces, and says what is loaded now', () => {
    const procedure = procedureById('bedMesh')!
    const ctx = context({
      mesh: () => ({ profile: 'default', range: 0.144, points: 9, temperature: null }),
    })
    expect(procedure.snapshot?.({}, ctx)).toEqual({ profile: 'default', range: '0.144 mm' })
    expect(procedure.current?.(ctx)).toBe('default · 0.144 mm')
    expect(procedure.current?.(context())).toBeNull()
  })

  it('reads the belts’ similarity and health, and names the graph the run wrote', () => {
    const ctx = context({ newestGraph: () => 'beltscomparison_20260929_211936.png' })
    const lines = [
      '// Belts estimated similarity: 87.3%',
      '// Mechanical health: Excellent mechanical health',
    ]
    const result = parseBelts(lines, { graph: 'beltscomparison_old.png' }, {}, ctx)
    expect(result?.outcome).toBe('measured')
    expect(result?.rows).toEqual([
      { label: { key: 'calibration.result.similarity' }, after: '87.3%' },
      { label: { key: 'calibration.result.health' }, after: 'Excellent mechanical health' },
      { label: { key: 'calibration.result.graph' }, after: 'beltscomparison_20260929_211936' },
    ])
    // The graph it started with is not the one it wrote.
    expect(
      parseBelts(lines, { graph: 'beltscomparison_20260929_211936.png' }, {}, ctx)?.rows,
    ).toHaveLength(2)
  })

  it('reads a vibration profile’s symmetry', () => {
    const result = parseVibrations(
      ['// Machine estimated vibration symmetry: 91.0%'],
      { graph: '' },
      {},
      context(),
    )
    expect(result?.rows).toEqual([
      { label: { key: 'calibration.result.symmetry' }, after: '91.0%' },
    ])
  })
})

describe('what the printer is set to', () => {
  it('says the file’s value for a procedure that has never run here', () => {
    const ctx = context({
      sections: ['probe', 'input_shaper', 'stepper_z', 'extruder'],
      settings: (section) =>
        ({
          probe: { z_offset: -0.85 },
          input_shaper: {
            shaper_type_x: 'mzv',
            shaper_freq_x: 52.4,
            shaper_type_y: 'ei',
            shaper_freq_y: 38.2,
          },
          stepper_z: { position_endstop: 0.5 },
          extruder: { rotation_distance: 22.678 },
        })[section] ?? null,
      livePressureAdvance: 0.045,
    })
    expect(procedureById('probeZOffset')!.current?.(ctx)).toBe('z_offset -0.85')
    expect(procedureById('shaperCalibrate')!.current?.(ctx)).toBe('x mzv 52.4 Hz · y ei 38.2 Hz')
    expect(procedureById('shakeTuneShaper')!.current?.(ctx)).toBe('x mzv 52.4 Hz · y ei 38.2 Hz')
    expect(procedureById('zEndstop')!.current?.(ctx)).toBe('position_endstop 0.5')
    expect(procedureById('rotationDistance')!.current?.(ctx)).toBe('rotation_distance 22.678')
    expect(procedureById('pressureAdvance')!.current?.(ctx)).toBe('pressure_advance 0.045')
    expect(procedureById('probeZOffset')!.current?.(context())).toBeNull()
  })

  it('asks the stepper check what only the reader saw', () => {
    expect(procedureById('stepperBuzz')!.answers?.map((question) => question.key)).toEqual([
      'moved',
      'direction',
    ])
  })
})

describe('what is due', () => {
  const day = 86_400_000
  const now = 1_000 * day

  it('ages a result past its procedure’s threshold, and never one that does not age', () => {
    expect(isProcedureStale(procedureById('bedMesh')!, now - 31 * day, now)).toBe(true)
    expect(isProcedureStale(procedureById('bedMesh')!, now - 29 * day, now)).toBe(false)
    expect(isProcedureStale(procedureById('probeAccuracy')!, now - 999 * day, now)).toBe(false)
  })

  it('opens a stage on the first ageing procedure that is due, else the first', () => {
    const procedures = [procedureById('probeAccuracy')!, procedureById('bedMesh')!]
    expect(initialProcedure(procedures, () => null, now)?.id).toBe('bedMesh')
    expect(initialProcedure(procedures, () => now, now)?.id).toBe('probeAccuracy')
  })
})

describe('bed screws from the status object', () => {
  const settings = (section: string) =>
    section === 'screws_tilt_adjust'
      ? {
          screw1: [30, 30],
          screw1_name: 'front left',
          screw2: [200, 30],
          screw2_name: 'front right',
          screw3: [115, 200],
          screw3_name: 'rear',
        }
      : null
  const results = {
    screw1: { z: 2.329, sign: 'CW' as const, adjust: '00:00', isBase: true },
    screw2: { z: 2.391, sign: 'CW' as const, adjust: '00:15', isBase: false },
    screw3: { z: 2.351, sign: 'CCW' as const, adjust: '00:05', isBase: false },
  }

  it('reads every screw from the status once it has changed since the run started', () => {
    const ctx = context({
      settings,
      screwsTilt: () => ({ error: false, maxDeviation: 0.05, results }),
    })
    const procedure = procedureById('screwsTilt')!
    const before = procedure.snapshot!({}, context({ screwsTilt: () => null }))
    const result = parseScrewsStatus(['// front left (base) : x=30.0'], before, {}, ctx)
    expect(result?.outcome).toBe('measured')
    expect(result?.screws?.map((screw) => [screw.name, screw.sign, screw.minutes])).toEqual([
      ['front left', null, 0],
      ['front right', 'CW', 15],
      ['rear', 'CCW', 5],
    ])
    expect(result?.rows).toEqual([
      { label: { literal: 'front left' }, after: '' },
      { label: { literal: 'front right' }, after: 'CW 00:15' },
      { label: { literal: 'rear' }, after: 'CCW 00:05' },
      { label: { key: 'calibration.result.maxDeviation' }, after: '0.050 mm' },
    ])
  })

  it('falls back to the printed lines while the status is the previous run’s, or absent', () => {
    const ctx = context({
      settings,
      screwsTilt: () => ({ error: false, maxDeviation: null, results }),
    })
    const before = procedureById('screwsTilt')!.snapshot!({}, ctx)
    const lines = [
      '// front left (base) : x=30.0, y=30.0, z=2.32900',
      '// front right : x=200.0, y=30.0, z=2.39100 : adjust CW 00:15',
    ]
    const stale = parseScrewsStatus(lines, before, {}, ctx)
    expect(stale?.screws).toBeUndefined()
    expect(stale?.rows.map((row) => row.after)).toEqual(['', 'CW 00:15'])
    expect(parseScrewsStatus(lines, {}, {}, context({ settings }))?.screws).toBeUndefined()
  })

  it('sends the turn direction only when one is chosen', () => {
    const procedure = procedureById('screwsTilt')!
    expect(procedure.build!({ DIRECTION: '' }, context())).toBe('SCREWS_TILT_CALCULATE')
    expect(procedure.build!({ DIRECTION: 'CCW' }, context())).toBe(
      'SCREWS_TILT_CALCULATE DIRECTION=CCW',
    )
  })
})

describe('the few parameters a run takes', () => {
  it('sends a resonance run bare, or with exactly the words that were filled in', () => {
    const shaper = procedureById('shakeTuneShaper')!
    const initial = initialProcedureValues(shaper, context())
    expect(shaper.build!(initial, context())).toBe('AXES_SHAPER_CALIBRATION')
    expect(
      shaper.build!({ ...initial, AXIS: 'x', MAX_SMOOTHING: '0.1', FREQ_END: '110' }, context()),
    ).toBe('AXES_SHAPER_CALIBRATION AXIS=x MAX_SMOOTHING=0.1 FREQ_END=110')
    expect(
      procedureById('shaperCalibrate')!.build!({ AXIS: '', MAX_SMOOTHING: '0.2' }, context()),
    ).toBe('SHAPER_CALIBRATE MAX_SMOOTHING=0.2')
    expect(
      procedureById('shakeTuneBelts')!.build!({ FREQ_START: '10', FREQ_END: '' }, context()),
    ).toBe('COMPARE_BELTS_RESPONSES FREQ_START=10')
    expect(
      procedureById('shakeTuneVibrations')!.build!(
        { SIZE: '80', MAX_SPEED: '', SPEED_INCREMENT: '', ACCEL: '5000' },
        context(),
      ),
    ).toBe('CREATE_VIBRATIONS_PROFILE SIZE=80 ACCEL=5000')
  })

  it('shows the printer’s own frequency range and probe settings as the placeholders', () => {
    const ctx = context({
      sections: ['resonance_tester', 'probe'],
      settings: (section) =>
        section === 'resonance_tester'
          ? { min_freq: 10, max_freq: 120 }
          : section === 'probe'
            ? { speed: 8, sample_retract_dist: 1.5 }
            : null,
    })
    const placeholders = (id: string) =>
      Object.fromEntries(
        (procedureById(id)!.params ?? []).map((parameter) => [
          parameter.key,
          parameter.placeholder?.(ctx) ?? '',
        ]),
      )
    expect(placeholders('shakeTuneBelts')).toEqual({ FREQ_START: '10', FREQ_END: '120' })
    expect(placeholders('probeAccuracy')).toMatchObject({
      PROBE_SPEED: '8',
      SAMPLE_RETRACT_DIST: '1.5',
    })
    expect(
      procedureById('probeAccuracy')!.build!(
        { SAMPLES: '', PROBE_SPEED: '3', SAMPLE_RETRACT_DIST: '' },
        ctx,
      ),
    ).toBe('PROBE_ACCURACY PROBE_SPEED=3')
    expect(
      procedureById('probeDrift')!.build!({ PROBE: 'nozzle', TARGET: '60', STEP: '5' }, ctx),
    ).toContain('STEP=5')
  })
})

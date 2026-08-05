import { describe, expect, it } from 'vitest'

import { isChangedRow, readPendingConfig } from '@/features/config/pendingConfig'

/**
 * The shapes here are copied from a real machine's `SAVE_CONFIG` block — a
 * Kalico printer running MPC with two saved meshes — because the rules being
 * tested are rules about what Klipper actually writes, and an invented fixture
 * would let a wrong assumption pass.
 */
const items = {
  probe: { z_offset: '0.285' },
  extruder: {
    control: 'mpc',
    block_heat_capacity: '18.9012',
    fan_ambient_transfer: '0.0721552, 0.0938029, 0.114071, 0.122898, 0.13757, 0.159513, 0.164303',
  },
  'bed_mesh default': {
    version: '1',
    points: '0.023447, 0.049697, 0.044854\n\t-0.001084, 0.026885, 0.045166',
    algo: 'bicubic',
    x_count: '3',
  },
}

const settings = {
  probe: { z_offset: 0.3, speed: 2 },
  extruder: { control: 'mpc', block_heat_capacity: 18.7534 },
  'bed_mesh default': { algo: 'direct' },
}

describe('readPendingConfig', () => {
  it('reads each staged section with what it would write', () => {
    const sections = readPendingConfig(items, settings)

    expect(sections.map((section) => section.section)).toEqual([
      'probe',
      'extruder',
      'bed_mesh default',
    ])
    expect(sections.map((section) => section.kind)).toEqual(['probe', 'heaterModel', 'bedMesh'])
  })

  /**
   * The whole point of reading both halves: the staged value alone says what
   * will be written, not what it replaces, and a Z offset is exactly the number
   * nobody should have to remember the old value of.
   */
  it('pairs a staged value with the one currently loaded', () => {
    const probe = readPendingConfig(items, settings)[0]

    expect(probe?.rows).toEqual([{ option: 'z_offset', next: '0.285', previous: '0.3' }])
  })

  /**
   * A bed mesh stages 168 numbers on a real printer. Printing them is how the
   * one line that matters gets buried, so a list of numbers reports its size —
   * the same rule the section list follows, applied one level down.
   */
  it('counts a value that is a list of numbers instead of printing it', () => {
    const sections = readPendingConfig(items, settings)
    const mesh = sections.find((section) => section.section === 'bed_mesh default')
    const points = mesh?.rows.find((row) => row.option === 'points')

    expect(points).toEqual({ option: 'points', next: null, previous: null, count: 6 })

    // A fan curve is a list too, by the same test rather than by its name.
    const extruder = sections.find((section) => section.section === 'extruder')
    expect(extruder?.rows.find((row) => row.option === 'fan_ambient_transfer')?.count).toBe(7)
  })

  /**
   * Found in the browser against a real machine: the mesh's *loaded* value is an
   * array of arrays, and stringifying it printed all 168 numbers into the row
   * and then arrowed to "168 values". The count rule had been applied to the
   * staged side and not the loaded one, which buried the row it was meant to
   * keep readable.
   */
  it('carries no previous value for a counted one, on either side', () => {
    const sections = readPendingConfig(
      { 'bed_mesh default': { points: '0.02, 0.04, 0.03' } },
      { 'bed_mesh default': { points: [[0.1, 0.2, 0.3]] } },
    )

    expect(sections[0]?.rows[0]).toEqual({
      option: 'points',
      next: null,
      previous: null,
      count: 3,
    })
  })

  it('keeps a single number a value rather than a count of one', () => {
    const sections = readPendingConfig({ probe: { z_offset: '0.285' } }, {})

    expect(sections[0]?.rows[0]).toEqual({ option: 'z_offset', next: '0.285', previous: null })
  })

  /** A word is not a number, so it is shown whatever its length. */
  it('shows a non-numeric value rather than counting its words', () => {
    const sections = readPendingConfig({ extruder: { control: 'mpc' } }, {})

    expect(sections[0]?.rows[0]?.next).toBe('mpc')
    expect(sections[0]?.rows[0]?.count).toBeUndefined()
  })

  /**
   * The same setting is written under several section names — a BLTouch and a
   * dockable probe both stage `z_offset` — so the reading follows the section's
   * type, not the single name `probe`.
   */
  it('reads every probing section as a probe, and a numbered extruder as a heater', () => {
    const sections = readPendingConfig(
      {
        bltouch: { z_offset: '1.9' },
        extruder1: { control: 'pid' },
        heater_bed: { control: 'pid' },
        stepper_z: { position_endstop: '0.5' },
      },
      {},
    )

    const kinds = Object.fromEntries(sections.map((section) => [section.section, section.kind]))
    expect(kinds).toEqual({
      bltouch: 'probe',
      extruder1: 'heaterModel',
      heater_bed: 'heaterModel',
      stepper_z: 'generic',
    })
  })

  /**
   * Deterministic, because this list re-renders on every status push while the
   * dialog is open: the probe offset someone just dialed in reads first, and
   * nothing reorders itself under the pointer.
   */
  it('orders sections by how they are read, then by name', () => {
    const sections = readPendingConfig(
      {
        'bed_mesh second': { algo: 'bicubic' },
        stepper_z: { position_endstop: '0.5' },
        'bed_mesh first': { algo: 'bicubic' },
        heater_bed: { control: 'pid' },
        probe: { z_offset: '0.2' },
      },
      {},
    )

    expect(sections.map((section) => section.section)).toEqual([
      'probe',
      'heater_bed',
      'bed_mesh first',
      'bed_mesh second',
      'stepper_z',
    ])
  })

  it('ignores a section that stages nothing', () => {
    expect(readPendingConfig({ probe: {} }, {})).toEqual([])
    expect(readPendingConfig({}, {})).toEqual([])
  })

  /** Values arrive as strings and settings arrive typed; neither side is coerced. */
  it('stringifies a loaded value without reformatting either side', () => {
    const sections = readPendingConfig(
      { probe: { z_offset: '0.300' } },
      { probe: { z_offset: 0.3 } },
    )

    expect(sections[0]?.rows[0]).toEqual({
      option: 'z_offset',
      next: '0.300',
      previous: '0.3',
    })
  })
})

describe('isChangedRow', () => {
  /**
   * A calibration restages its whole block, including the coefficients it
   * recomputed to the same value — so "what moved" is a separate question from
   * "what gets written", and this answers only the first.
   */
  it('marks a row changed only when the value actually differs', () => {
    expect(isChangedRow({ option: 'a', next: '0.285', previous: '0.3' })).toBe(true)
    expect(isChangedRow({ option: 'a', next: '0.3', previous: '0.3' })).toBe(false)
    // Whitespace is written, not meant.
    expect(isChangedRow({ option: 'a', next: ' 0.3 ', previous: '0.3' })).toBe(false)
  })

  it('treats an option the running config lacks as changed', () => {
    expect(isChangedRow({ option: 'a', next: '1', previous: null })).toBe(true)
  })

  /** A counted value has no text to compare, so it is never claimed unchanged. */
  it('treats a counted value as changed', () => {
    expect(isChangedRow({ option: 'points', next: null, previous: null, count: 168 })).toBe(true)
  })
})

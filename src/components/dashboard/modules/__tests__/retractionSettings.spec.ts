import { describe, expect, it } from 'vitest'

import {
  readRetractionFields,
  retractionArguments,
  steppedRetractionValue,
} from '@/components/dashboard/modules/retractionSettings'

/** What mainline Klipper's `firmware_retraction` object reports. */
const klipperReported = {
  retract_length: 0.5,
  retract_speed: 60,
  unretract_extra_length: 0,
  unretract_speed: 60,
  // Derived from the two lengths above, and not settable.
  unretract_length: 0.5,
}

/** Kalico's, which adds Z hop. */
const kalicoReported = { ...klipperReported, z_hop_height: 0.4 }

describe('retractionSettings', () => {
  it('draws each length beside the speed it applies to', () => {
    expect(readRetractionFields(klipperReported).map((field) => field.key)).toEqual([
      'retract_length',
      'retract_speed',
      'unretract_extra_length',
      'unretract_speed',
    ])
  })

  /*
   * The same rule pressure advance follows: the settings a firmware has are
   * discovered from what it reports, never from what it is called.
   */
  it('grows by whatever the firmware reports, without naming the firmware', () => {
    expect(readRetractionFields(kalicoReported).at(-1)?.key).toBe('z_hop_height')
    expect(readRetractionFields(kalicoReported)).toHaveLength(5)
  })

  /*
   * `unretract_length` is retract length plus the extra, and `SET_RETRACTION`
   * has no parameter for it. A field would be offering to set a number the
   * command cannot carry.
   */
  it('never offers a derived value as a field', () => {
    const keys = readRetractionFields(kalicoReported).map((field) => field.key)
    expect(keys).not.toContain('unretract_length')
  })

  it('has nothing to draw before the printer has reported anything', () => {
    expect(readRetractionFields({})).toEqual([])
  })

  it('sends one command carrying only the parameters this firmware has', () => {
    const fields = readRetractionFields(klipperReported)
    expect(retractionArguments(fields, klipperReported)).toEqual([
      'RETRACT_LENGTH=0.5',
      'RETRACT_SPEED=60',
      'UNRETRACT_EXTRA_LENGTH=0',
      'UNRETRACT_SPEED=60',
    ])
  })

  it('rounds each parameter to its own precision, so a speed is never sent as 60.00', () => {
    const fields = readRetractionFields(kalicoReported)
    const sent = retractionArguments(fields, {
      ...kalicoReported,
      retract_length: 0.15000000000000002,
      retract_speed: 45.4,
    })
    expect(sent).toContain('RETRACT_LENGTH=0.15')
    expect(sent).toContain('RETRACT_SPEED=45')
    expect(sent).toContain('Z_HOP_HEIGHT=0.4')
  })

  it('omits a value the user has not filled in rather than sending NaN', () => {
    const fields = readRetractionFields(klipperReported)
    const sent = retractionArguments(fields, { ...klipperReported, retract_speed: Number.NaN })
    expect(sent.some((argument) => argument.startsWith('RETRACT_SPEED'))).toBe(false)
    expect(sent).toContain('RETRACT_LENGTH=0.5')
  })

  /*
   * Binary addition of 0.05 does not stay on two decimals by itself, and a
   * length that drifts to 0.15000000000000002 is one Klipper accepts and nobody
   * wants to read.
   */
  it('steps on the field’s own precision and stops at zero', () => {
    const [length, speed] = readRetractionFields(klipperReported)
    expect(steppedRetractionValue(length!, 0.1, 1)).toBe(0.15)
    expect(steppedRetractionValue(length!, 0.15, 1)).toBe(0.2)
    expect(steppedRetractionValue(length!, 0.02, -1)).toBe(0)
    expect(steppedRetractionValue(speed!, 60, -1)).toBe(59)
  })
})

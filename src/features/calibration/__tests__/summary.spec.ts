import { describe, expect, it } from 'vitest'

import type { ProcedureResultRow } from '@/features/calibration/procedures'
import { headlineRows } from '@/features/calibration/summary'

const keyed = (key: string, after: string): ProcedureResultRow => ({ label: { key }, after })
const pending = (section: string, option: string, after: string): ProcedureResultRow => ({
  label: { literal: `${section} · ${option}` },
  after,
})

describe('headlineRows', () => {
  it('leads with the rows the procedure names, in its order', () => {
    const rows = [
      keyed('calibration.probe.maximum', '1.234'),
      keyed('calibration.probe.range', '0.012'),
      keyed('calibration.probe.standardDeviation', '0.004'),
    ]

    expect(
      headlineRows(
        { listRows: ['calibration.probe.range', 'calibration.probe.standardDeviation'] },
        rows,
      ),
    ).toEqual([rows[1], rows[2]])
  })

  it('prefers what the run printed, in its order, over the pending items staged beside it', () => {
    const printed: ProcedureResultRow = { label: { literal: 'rotation_distance' }, after: '40' }
    const named = keyed('calibration.result.similarity', '99.5%')
    expect(headlineRows({}, [pending('probe', 'z_offset', '0.480'), printed, named])).toEqual([
      printed,
      named,
    ])
  })

  it('says a single section once rather than before every value', () => {
    const shown = headlineRows({}, [
      pending('input_shaper', 'shaper_type_x', 'smooth_mzv'),
      pending('input_shaper', 'shaper_freq_x', '64.4'),
    ])

    expect(shown.map((row) => row.label)).toEqual([
      { literal: 'shaper_type_x' },
      { literal: 'shaper_freq_x' },
    ])
  })

  /** A saved profile stages its whole serialisation; only the grid reads as a result. */
  it('reduces a saved mesh profile to its name and grid', () => {
    const shown = headlineRows({}, [
      pending('bed_mesh default', 'version', '1'),
      pending('bed_mesh default', 'x_count', '12'),
      pending('bed_mesh default', 'y_count', '9'),
      pending('bed_mesh default', 'points', '\n0.1, 0.2'),
    ])

    expect(shown).toEqual([{ label: { literal: 'default' }, after: '12 × 9' }])
  })

  it('keeps to the limit and drops empty values', () => {
    const rows = ['a', 'b', 'c', 'd'].map((name) => keyed(name, name))
    expect(headlineRows({}, [keyed('empty', ''), ...rows])).toEqual(rows.slice(0, 3))
  })
})

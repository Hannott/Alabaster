import { describe, expect, it } from 'vitest'

import { firstContentMatch } from '@/stores/machineFiles'

describe('firstContentMatch', () => {
  it('reports the line and column of the first match, ignoring case', () => {
    const text = '[extruder]\r\nstep_pin: PA1\r\nrotation_distance: 22\r\nRotation_Distance: 7'
    expect(firstContentMatch(text, 'rotation_distance')).toEqual({ line: 2, column: 0, length: 17 })
  })

  it('counts columns from the start of the matching line', () => {
    expect(firstContentMatch('a\nb: pin PA1', 'pa1')).toEqual({ line: 1, column: 7, length: 3 })
    expect(firstContentMatch('pa1 first', 'pa1')).toEqual({ line: 0, column: 0, length: 3 })
  })

  it('has no match for text the file does not contain', () => {
    expect(firstContentMatch('[stepper_x]', 'extruder')).toBeNull()
  })
})

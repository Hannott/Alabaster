import { describe, expect, it } from 'vitest'

import { homedAxesOf } from '@/stores/commandQueue'

describe('homedAxesOf', () => {
  it('reads the axes a home names, and every axis for a bare G28', () => {
    expect([...homedAxesOf('G28 X\nM400')]).toEqual(['X'])
    expect([...homedAxesOf('g28 y z')]).toEqual(['Y', 'Z'])
    expect([...homedAxesOf('G28\nM400')]).toEqual(['X', 'Y', 'Z'])
    expect([...homedAxesOf('M400')]).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import { nextAvailableProfileName, profileNameIssue } from '@/features/bedMesh/profileNames'

describe('profileNameIssue', () => {
  it('rejects a blank name', () => {
    expect(profileNameIssue('   ', [])).toBe('empty')
  })

  it('rejects a name Klipper would write into printer.cfg mangled', () => {
    expect(profileNameIssue('café', [])).toBe('nonAscii')
  })

  it('rejects a name already saved under a different profile', () => {
    expect(profileNameIssue('default', ['default', 'cold'])).toBe('taken')
  })

  it('allows the one name excepted from the collision check', () => {
    expect(profileNameIssue('default', ['default', 'cold'], 'default')).toBeUndefined()
  })

  it('accepts a genuinely new name', () => {
    expect(profileNameIssue('garage', ['default', 'cold'])).toBeUndefined()
  })
})

describe('nextAvailableProfileName', () => {
  it('keeps the base name when nothing collides', () => {
    expect(nextAvailableProfileName('default', [])).toBe('default')
    expect(nextAvailableProfileName('default', ['cold'])).toBe('default')
  })

  it('suggests the next free numbered variant once the base is taken', () => {
    expect(nextAvailableProfileName('default', ['default'])).toBe('default2')
    expect(nextAvailableProfileName('default', ['default', 'default2'])).toBe('default3')
    expect(nextAvailableProfileName('default', ['default', 'default2', 'default3'])).toBe(
      'default4',
    )
  })

  it('fills the first open number rather than counting every taken one', () => {
    expect(nextAvailableProfileName('default', ['default', 'default3'])).toBe('default2')
  })
})

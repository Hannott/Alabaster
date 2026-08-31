import { beforeEach, describe, expect, it } from 'vitest'

import { useMinimalisticSidebar } from '@/composables/useMinimalisticSidebar'

describe('minimalistic sidebar preference', () => {
  const minimalisticSidebar = useMinimalisticSidebar()

  beforeEach(() => {
    minimalisticSidebar.setMinimalisticSidebar(false)
  })

  it('defaults to false', () => {
    expect(minimalisticSidebar.isMinimalisticSidebar.value).toBe(false)
  })

  it('persists the preference locally', () => {
    minimalisticSidebar.setMinimalisticSidebar(true)

    expect(minimalisticSidebar.isMinimalisticSidebar.value).toBe(true)
    expect(localStorage.getItem('alabaster.sidebar.minimalistic')).toBe('true')

    minimalisticSidebar.setMinimalisticSidebar(false)

    expect(minimalisticSidebar.isMinimalisticSidebar.value).toBe(false)
    expect(localStorage.getItem('alabaster.sidebar.minimalistic')).toBe('false')
  })
})

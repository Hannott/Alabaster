import { beforeEach, describe, expect, it } from 'vitest'

import { useSidebar } from '@/composables/useSidebar'

describe('sidebar preference', () => {
  const sidebar = useSidebar()

  beforeEach(() => {
    sidebar.setSidebarCollapsed(false)
  })

  it('persists the collapsed state locally', () => {
    sidebar.toggleSidebar()

    expect(sidebar.isSidebarCollapsed.value).toBe(true)
    expect(localStorage.getItem('alabaster.sidebar.collapsed')).toBe('true')

    sidebar.toggleSidebar()

    expect(sidebar.isSidebarCollapsed.value).toBe(false)
    expect(localStorage.getItem('alabaster.sidebar.collapsed')).toBe('false')
  })
})

import { describe, expect, it } from 'vitest'

import en from '@/locales/en.json'
import nb from '@/locales/nb.json'
import {
  isDestinationSupported,
  navigationDestinations,
  type MachineCapabilities,
  type NavigationDestination,
} from '@/navigation/destinations'
import { router } from '@/router'

function capabilities(overrides: Partial<MachineCapabilities> = {}): MachineCapabilities {
  return {
    hasRoot: () => true,
    hasComponent: () => true,
    hasConfigSection: () => true,
    ...overrides,
  }
}

function destination(name: string): NavigationDestination {
  const match = navigationDestinations.find((candidate) => candidate.name === name)
  if (!match) throw new Error(`no destination named ${name}`)
  return match
}

describe('navigation destinations', () => {
  it('is ordered by position, with no two destinations claiming one', () => {
    const positions = navigationDestinations.map((entry) => entry.position)
    expect(positions).toEqual([...positions].sort((first, second) => first - second))
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('numbers positions in tens so a new destination needs no renumbering', () => {
    for (const entry of navigationDestinations) expect(entry.position % 10).toBe(0)
  })

  it('points every destination at a route that exists', () => {
    const routeNames = new Set(router.getRoutes().map((route) => route.name))
    for (const entry of navigationDestinations) expect(routeNames).toContain(entry.name)
  })

  it('labels every destination in every locale', () => {
    const locales: Array<[string, Record<string, Record<string, string>>]> = [
      ['en', en as never],
      ['nb', nb as never],
    ]

    for (const entry of navigationDestinations) {
      const [group, key] = entry.labelKey.split('.')
      for (const [name, messages] of locales) {
        expect(messages[group]?.[key], `${name} is missing ${entry.labelKey}`).toBeTruthy()
      }
    }
  })

  /**
   * The defect this guards: the mobile navigation used to render a shorter list
   * with the remainder simply dropped, which left `/gcode-viewer` reachable only
   * by typing its hash. Every destination has to be in the bar or in its
   * overflow — being in neither is unreachable, not merely inconvenient.
   */
  it('keeps every destination reachable on mobile', () => {
    const reachable = navigationDestinations.filter(
      (entry) => entry.mobile === 'bar' || entry.mobile === 'overflow',
    )
    expect(reachable).toHaveLength(navigationDestinations.length)
  })

  it('leaves room for the overflow control in the five-cell mobile bar', () => {
    const bar = navigationDestinations.filter((entry) => entry.mobile === 'bar')
    const overflow = navigationDestinations.filter((entry) => entry.mobile === 'overflow')
    expect(bar.length + (overflow.length > 0 ? 1 : 0)).toBeLessThanOrEqual(5)
  })

  it('shows an ungated destination whatever the machine reports', () => {
    const overview = destination('overview')
    expect(overview.capability).toBeUndefined()
    expect(
      isDestinationSupported(
        overview,
        capabilities({
          hasRoot: () => false,
          hasComponent: () => false,
          hasConfigSection: () => false,
        }),
      ),
    ).toBe(true)
  })

  it('hides the configuration workspace when Moonraker registers no config root', () => {
    const fileExplorer = destination('configuration')
    expect(isDestinationSupported(fileExplorer, capabilities())).toBe(true)
    expect(
      isDestinationSupported(fileExplorer, capabilities({ hasRoot: (root) => root !== 'config' })),
    ).toBe(false)
  })

  it('checks each declared capability independently', () => {
    const gated: NavigationDestination = {
      name: 'machine',
      labelKey: 'navigation.machine',
      icon: 'machine',
      position: 999,
      mobile: 'overflow',
      capability: { root: 'gcodes', component: 'history', configSection: 'bed_mesh' },
    }

    expect(isDestinationSupported(gated, capabilities())).toBe(true)
    expect(isDestinationSupported(gated, capabilities({ hasRoot: () => false }))).toBe(false)
    expect(isDestinationSupported(gated, capabilities({ hasComponent: () => false }))).toBe(false)
    expect(isDestinationSupported(gated, capabilities({ hasConfigSection: () => false }))).toBe(
      false,
    )
  })
})

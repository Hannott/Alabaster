import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { dashboardModuleIds } from '@/dashboard/layout'
import { presetVisibleModules } from '@/dashboard/presets'
import {
  migrateLegacyProfile,
  normalizeDashboardProfile,
  useDashboardLayoutStore,
} from '@/stores/dashboardLayout'

const legacyFlatStorageKey = 'alabaster.dashboard.layouts.v1'
const legacySpanStorageKey = 'alabaster.dashboard.profiles.v2'

/** The cards a user would actually see stacked in one desktop column, in order. */
function visibleColumn(
  layout: ReturnType<typeof useDashboardLayoutStore>,
  column: number,
): string[] {
  return layout.profile.placements.desktop
    .filter((placement) => placement.column === column && placement.visible)
    .map((placement) => placement.instanceId)
}

describe('dashboard profile normalization', () => {
  it('repairs malformed instances and placements', () => {
    const profile = normalizeDashboardProfile({
      instances: [
        { instanceId: 'macros', moduleId: 'macros', config: { macros: ['HOME'] } },
        { instanceId: 'macros', moduleId: 'macros' },
        { instanceId: 'macros-2', moduleId: 'macros', title: '  Calibration  ' },
        { instanceId: 'nonsense' },
      ],
      placements: {
        desktop: [
          { instanceId: 'macros-2', column: 99, visible: false, collapsed: true },
          { instanceId: 'macros-2', column: 1, visible: true },
          { instanceId: 'ghost', column: 1, visible: true },
        ],
      },
    })

    expect(profile.instances.filter((instance) => instance.moduleId === 'macros')).toHaveLength(2)
    expect(profile.instances[0]?.config).toEqual({ macros: ['HOME'] })
    expect(profile.instances[1]?.title).toBe('Calibration')
    // Every registered module keeps an instance, so nothing becomes unreachable.
    expect(new Set(profile.instances.map((instance) => instance.moduleId))).toEqual(
      new Set(dashboardModuleIds),
    )

    const desktop = profile.placements.desktop
    expect(desktop[0]).toEqual({
      instanceId: 'macros-2',
      column: 2,
      visible: false,
      collapsed: true,
    })
    expect(desktop.some((placement) => placement.instanceId === 'ghost')).toBe(false)
    expect(desktop).toHaveLength(profile.instances.length)
    expect(profile.placements.mobile.every((placement) => placement.column === 0)).toBe(true)
    expect(profile.columnWidths.desktop).toEqual({ shape: 'equal', target: 0 })
  })

  /*
   * A module id is a storage key, so renaming one is only safe with an entry in
   * `renamedModuleIds`. Without the rename every one of these assertions fails
   * the same silent way: the instance resolves to nothing, is dropped, and the
   * tray hands back a pristine card — losing the placement and the per-instance
   * configuration of a card the user had set up, with no error anywhere.
   */
  it('carries a card renamed since it was stored, with its configuration and placement', () => {
    const profile = normalizeDashboardProfile({
      instances: [
        { instanceId: 'filament', moduleId: 'filament', config: { length: 60 } },
        { instanceId: 'filament-2', moduleId: 'filament', title: 'Second tool' },
      ],
      placements: {
        desktop: [{ instanceId: 'filament-2', column: 1, visible: true, collapsed: true }],
      },
    })

    const renamed = profile.instances.filter((instance) => instance.moduleId === 'extruder')
    expect(renamed.map((instance) => instance.instanceId)).toEqual(['extruder', 'extruder-2'])
    expect(renamed[0]?.config).toEqual({ length: 60 })
    expect(renamed[1]?.title).toBe('Second tool')
    // The suffix travels with the id, so the placement still finds its instance.
    expect(profile.placements.desktop[0]).toEqual({
      instanceId: 'extruder-2',
      column: 1,
      visible: true,
      collapsed: true,
    })
    // And the freed name is gone rather than aliased: a Spoolman-backed
    // filament module is planned and must be able to claim it.
    expect(profile.instances.some((instance) => instance.instanceId === 'filament')).toBe(false)
  })

  it('gives a missing profile the standard preset', () => {
    const profile = normalizeDashboardProfile(undefined)
    const visible = profile.placements.desktop
      .filter((placement) => placement.visible)
      .map((placement) => placement.instanceId)

    expect(visible).toEqual([...presetVisibleModules('standard')])
  })

  it('assigns a missing column round-robin by position, spreading legacy span data', () => {
    const profile = normalizeDashboardProfile({
      instances: [],
      placements: {
        desktop: [
          { instanceId: 'print', span: 8, visible: true },
          { instanceId: 'camera', span: 4, visible: true },
          { instanceId: 'temperatures', span: 5, visible: true },
          { instanceId: 'movement', span: 4, visible: true },
        ],
      },
    })

    expect(
      profile.placements.desktop
        .slice(0, 4)
        .map((placement) => [placement.instanceId, placement.column]),
    ).toEqual([
      ['print', 0],
      ['camera', 1],
      ['temperatures', 2],
      ['movement', 0],
    ])
  })

  it('migrates version 1 layouts and gives new modules their preset visibility', () => {
    const profile = migrateLegacyProfile({
      desktop: [
        { id: 'console', span: 7, visible: true },
        { id: 'print', span: 8, visible: false },
        // A v1 profile predates every rename by definition, so this reader
        // needs the same treatment the v3 one gets.
        { id: 'filament', span: 4, visible: true },
      ],
    })

    expect(profile?.placements.desktop[0]).toEqual({
      instanceId: 'console',
      column: 0,
      visible: true,
      collapsed: false,
    })
    expect(profile?.placements.desktop[1]?.visible).toBe(false)
    expect(profile?.placements.desktop[2]).toMatchObject({
      instanceId: 'extruder',
      visible: true,
    })
    expect(
      profile?.placements.desktop.find((placement) => placement.instanceId === 'jobQueue')?.visible,
    ).toBe(false)
    expect(
      profile?.placements.desktop.find((placement) => placement.instanceId === 'macros')?.visible,
    ).toBe(true)
    expect(profile?.columnWidths.desktop).toEqual({ shape: 'equal', target: 0 })
  })
})

describe('dashboard layout store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('persists placement and configuration per printer scope', () => {
    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('ws://printer-a/websocket')
    layout.moveColumn('desktop', 'camera', 1)
    layout.setVisible('desktop', 'activity', false)
    layout.reorder('desktop', 'console', 'print')
    layout.toggleCollapsed('desktop', 'temperatures')
    layout.updateConfig('macros', { macros: ['CALIBRATE_MESH'] })

    const items = layout.itemsFor('desktop')
    expect(items[0]?.instance.instanceId).toBe('console')
    expect(items.find((item) => item.instance.instanceId === 'camera')?.placement.column).toBe(2)
    expect(
      items.find((item) => item.instance.instanceId === 'temperatures')?.placement.collapsed,
    ).toBe(true)

    layout.selectPrinterScope('ws://printer-b/websocket')
    expect(layout.itemsFor('desktop')[0]?.instance.instanceId).toBe('print')
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.config,
    ).toEqual({})

    layout.selectPrinterScope('ws://printer-a/websocket')
    expect(layout.itemsFor('desktop')[0]?.instance.instanceId).toBe('console')
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.config,
    ).toEqual({ macros: ['CALIBRATE_MESH'] })
  })

  it('moves a module within its column without crossing into a neighboring column', () => {
    const layout = useDashboardLayoutStore()
    // Standard preset, desktop (3 columns): print/movement/console share column 0.
    layout.move('desktop', 'console', -1)

    const desktopIds = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(desktopIds.indexOf('console')).toBeLessThan(desktopIds.indexOf('movement'))
    expect(
      layout.profile.placements.desktop.find((placement) => placement.instanceId === 'console')
        ?.column,
    ).toBe(0)
  })

  it('moves a module into an adjacent column and clamps at the edges', () => {
    const layout = useDashboardLayoutStore()
    layout.moveColumn('desktop', 'print', -1)
    expect(
      layout.profile.placements.desktop.find((placement) => placement.instanceId === 'print')
        ?.column,
    ).toBe(0)

    layout.moveColumn('desktop', 'print', 1)
    layout.moveColumn('desktop', 'print', 1)
    layout.moveColumn('desktop', 'print', 1)
    expect(
      layout.profile.placements.desktop.find((placement) => placement.instanceId === 'print')
        ?.column,
    ).toBe(2)
  })

  it('reorders past the card directly below it instead of leaving it in place', () => {
    const layout = useDashboardLayoutStore()
    // Standard preset, desktop (3 columns): print/movement/console share column 0.
    layout.reorder('desktop', 'print', 'movement')

    const desktopIds = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(desktopIds.indexOf('print')).toBeGreaterThan(desktopIds.indexOf('movement'))
  })

  it('moves a card all the way to the end of its column', () => {
    const layout = useDashboardLayoutStore()
    // console is the last card the user can see in column 0; bedMesh also sits
    // in that column but is hidden under the standard preset, so it is not a
    // slot anything can be dropped onto.
    layout.reorder('desktop', 'print', 'console')

    expect(visibleColumn(layout, 0)).toEqual(['movement', 'console', 'print'])
  })

  it('leaves a hidden card beside the neighbour it was stored next to', () => {
    const layout = useDashboardLayoutStore()
    // bedMesh is hidden and stored directly after console in column 0. Moving
    // print to the end must not jump it over bedMesh, or restoring bedMesh from
    // the tray later would surface it in a position nothing chose.
    const before = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(before.indexOf('bedMesh')).toBeGreaterThan(before.indexOf('console'))

    layout.reorder('desktop', 'print', 'console')

    const after = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(after.indexOf('print')).toBeLessThan(after.indexOf('bedMesh'))
    expect(after.indexOf('console')).toBeLessThan(after.indexOf('print'))
  })

  it('refuses to order a card against one that is hidden', () => {
    const layout = useDashboardLayoutStore()
    const before = layout.profile.placements.desktop.map((placement) => placement.instanceId)

    layout.reorder('desktop', 'print', 'bedMesh')

    expect(layout.profile.placements.desktop.map((placement) => placement.instanceId)).toEqual(
      before,
    )
  })

  it('steps over the visible card below, never a hidden one', () => {
    const layout = useDashboardLayoutStore()
    // console is last among column 0's visible cards, so there is nothing
    // below it to trade places with even though bedMesh follows in the list.
    const before = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    layout.move('desktop', 'console', 1)

    expect(layout.profile.placements.desktop.map((placement) => placement.instanceId)).toEqual(
      before,
    )
  })

  it('sets and clamps the column width preset per viewport', () => {
    const layout = useDashboardLayoutStore()
    layout.setColumnWidths('desktop', { shape: 'wide', target: 1 })
    expect(layout.columnWidthsFor('desktop')).toEqual({ shape: 'wide', target: 1 })

    layout.setColumnWidths('mobile', { shape: 'narrow', target: 5 })
    expect(layout.columnWidthsFor('mobile')).toEqual({ shape: 'narrow', target: 0 })
  })

  it('duplicates a module into every viewport and copies its configuration', () => {
    const layout = useDashboardLayoutStore()
    layout.updateConfig('macros', { macros: ['HOME'] })
    const duplicateId = layout.duplicateInstance('desktop', 'macros')

    expect(duplicateId).toBe('macros-2')
    expect(layout.instanceCountFor('macros')).toBe(2)
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros-2')?.config,
    ).toEqual({ macros: ['HOME'] })

    const desktopIds = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(desktopIds.indexOf('macros-2')).toBe(desktopIds.indexOf('macros') + 1)
    expect(
      layout.profile.placements.mobile.some((placement) => placement.instanceId === 'macros-2'),
    ).toBe(true)

    layout.renameInstance('macros-2', 'Calibration')
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros-2')?.title,
    ).toBe('Calibration')

    layout.removeInstance('macros-2')
    expect(layout.instanceCountFor('macros')).toBe(1)
    expect(
      layout.profile.placements.mobile.some((placement) => placement.instanceId === 'macros-2'),
    ).toBe(false)
  })

  it('duplicates an empty card when asked for a fresh group rather than a twin', () => {
    const layout = useDashboardLayoutStore()
    layout.updateConfig('macros', { macros: ['HOME'] })
    const duplicateId = layout.duplicateInstance('desktop', 'macros', { emptyConfig: true })

    expect(duplicateId).toBe('macros-2')
    // A new group starts with nothing chosen; a copy that arrives pre-filled
    // with the first group's macros has to be emptied before it can be filled.
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros-2')?.config,
    ).toEqual({})

    const desktopIds = layout.profile.placements.desktop.map((placement) => placement.instanceId)
    expect(desktopIds.indexOf('macros-2')).toBe(desktopIds.indexOf('macros') + 1)
  })

  it('keeps the last instance of a module so the tray can restore it', () => {
    const layout = useDashboardLayoutStore()
    layout.removeInstance('macros')
    expect(layout.instanceCountFor('macros')).toBe(1)
  })

  it('applies a preset without discarding configured instances or the column width', () => {
    const layout = useDashboardLayoutStore()
    layout.updateConfig('macros', { macros: ['HOME'] })
    layout.setColumnWidths('desktop', { shape: 'wide', target: 2 })
    layout.applyPreset('minimal')

    const visible = layout
      .itemsFor('desktop')
      .filter((item) => item.placement.visible)
      .map((item) => item.instance.moduleId)
    expect(visible).toEqual([...presetVisibleModules('minimal')])
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.config,
    ).toEqual({ macros: ['HOME'] })
    expect(layout.columnWidthsFor('desktop')).toEqual({ shape: 'wide', target: 2 })
  })

  it('resets placement and column widths for one viewport', () => {
    const layout = useDashboardLayoutStore()
    layout.moveColumn('desktop', 'print', 1)
    layout.setColumnWidths('desktop', { shape: 'narrow', target: 1 })
    layout.reset('desktop')

    expect(
      layout.profile.placements.desktop.find((placement) => placement.instanceId === 'print')
        ?.column,
    ).toBe(0)
    expect(layout.columnWidthsFor('desktop')).toEqual({ shape: 'equal', target: 0 })
  })

  it('reads a version 1 layout from storage when no newer profile exists', () => {
    window.localStorage.setItem(
      legacyFlatStorageKey,
      JSON.stringify({
        version: 1,
        scopes: {
          'ws://printer-a/websocket': {
            desktop: [{ id: 'console', span: 7, visible: true }],
            tablet: [],
            mobile: [],
          },
        },
      }),
    )

    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('ws://printer-a/websocket')
    expect(layout.itemsFor('desktop')[0]?.instance.instanceId).toBe('console')
  })

  it('reads a version 2 span-based layout from storage when no version 3 profile exists', () => {
    window.localStorage.setItem(
      legacySpanStorageKey,
      JSON.stringify({
        version: 2,
        scopes: {
          'ws://printer-a/websocket': {
            instances: [{ instanceId: 'console', moduleId: 'console' }],
            placements: {
              desktop: [{ instanceId: 'console', span: 7, visible: true }],
            },
          },
        },
      }),
    )

    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('ws://printer-a/websocket')
    expect(layout.itemsFor('desktop')[0]?.instance.instanceId).toBe('console')
  })
})

/**
 * Backs "copy the dashboard from" when adding a printer. A pure storage
 * operation — the printer being added is never the one on screen, so there is
 * no live `profile`/`scope` to route through.
 */
describe('copying a profile between printers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('seeds a new printer from an existing one, as an independent copy', () => {
    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('printer-a')
    layout.moveColumn('desktop', 'camera', 1)
    layout.updateConfig('macros', { macros: ['CALIBRATE_MESH'] })
    const movedColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column

    layout.copyProfileFrom(['printer-a'], 'printer-b')
    layout.selectPrinterScope('printer-b')

    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'camera')?.placement
        .column,
    ).toBe(movedColumn)
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.config,
    ).toEqual({ macros: ['CALIBRATE_MESH'] })

    // A genuine copy, not a shared reference: editing the new printer's profile
    // must never reach back into the one it was copied from.
    layout.updateConfig('macros', { macros: ['A_DIFFERENT_MACRO'] })
    layout.selectPrinterScope('printer-a')
    expect(
      layout.profile.instances.find((instance) => instance.instanceId === 'macros')?.config,
    ).toEqual({ macros: ['CALIBRATE_MESH'] })
  })

  it('falls back to an older key the source profile might still be filed under', () => {
    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('ws://voron.local:7125/websocket')
    layout.setVisible('desktop', 'activity', false)

    // The identity key leads and has nothing stored yet; the endpoint key does.
    layout.copyProfileFrom(['printer-a', 'ws://voron.local:7125/websocket'], 'printer-b')
    layout.selectPrinterScope('printer-b')

    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'activity')?.placement
        .visible,
    ).toBe(false)
  })

  it('does nothing when no source has a stored profile', () => {
    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('printer-b')
    layout.moveColumn('desktop', 'camera', 1)
    const movedColumn = layout
      .itemsFor('desktop')
      .find((item) => item.instance.instanceId === 'camera')?.placement.column

    layout.copyProfileFrom(['printer-nonexistent'], 'printer-b')
    layout.selectPrinterScope('printer-b')

    // Nothing was overwritten: the mutation made before the no-op copy survives.
    expect(
      layout.itemsFor('desktop').find((item) => item.instance.instanceId === 'camera')?.placement
        .column,
    ).toBe(movedColumn)
  })

  it('ignores an empty target rather than writing a scope with no name', () => {
    const layout = useDashboardLayoutStore()
    layout.selectPrinterScope('printer-a')
    layout.moveColumn('desktop', 'camera', 1)

    expect(() => layout.copyProfileFrom(['printer-a'], '')).not.toThrow()

    const stored = JSON.parse(
      window.localStorage.getItem('alabaster.dashboard.profiles.v3') ?? '{}',
    ) as { scopes?: Record<string, unknown> }
    expect(stored.scopes?.['']).toBeUndefined()
  })
})

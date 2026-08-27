import {
  dashboardModuleIds,
  dashboardViewports,
  defaultColumnForIndex,
  defaultColumnWidths,
  type DashboardColumnWidthsByViewport,
  type DashboardModuleId,
  type DashboardPlacements,
  type DashboardProfile,
} from '@/dashboard/layout'

export const dashboardPresetIds = ['minimal', 'standard', 'tuning'] as const

export type DashboardPresetId = (typeof dashboardPresetIds)[number]

export const defaultDashboardPresetId: DashboardPresetId = 'standard'

/**
 * Presets decide which modules a printer starts with. They replace a long list
 * of individual toggles: pick the working mode, then adjust single modules.
 */
const presetModules: Record<DashboardPresetId, readonly DashboardModuleId[]> = {
  minimal: ['print', 'camera', 'temperatures', 'movement'],
  standard: [
    'print',
    'camera',
    'temperatures',
    'movement',
    'controls',
    'macros',
    'console',
    'activity',
  ],
  tuning: [
    'print',
    'temperatures',
    'movement',
    'controls',
    'macros',
    'extruder',
    'bedMesh',
    'console',
  ],
}

export function isDashboardPresetId(value: unknown): value is DashboardPresetId {
  return typeof value === 'string' && dashboardPresetIds.includes(value as DashboardPresetId)
}

export function presetVisibleModules(preset: DashboardPresetId): readonly DashboardModuleId[] {
  return presetModules[preset]
}

/**
 * Every module keeps an instance so it can be restored from the module tray
 * without losing its configuration; the preset only decides visibility.
 */
export function dashboardProfileForPreset(preset: DashboardPresetId): DashboardProfile {
  const visibleModules = new Set(presetModules[preset])
  const orderedModules = [
    ...presetModules[preset],
    ...dashboardModuleIds.filter((moduleId) => !visibleModules.has(moduleId)),
  ]

  const placements = Object.fromEntries(
    dashboardViewports.map((viewport) => [
      viewport,
      orderedModules.map((moduleId, index) => ({
        instanceId: moduleId,
        column: defaultColumnForIndex(index, viewport),
        visible: visibleModules.has(moduleId),
        collapsed: false,
      })),
    ]),
  ) as DashboardPlacements

  const columnWidths = Object.fromEntries(
    dashboardViewports.map((viewport) => [viewport, defaultColumnWidths(viewport)]),
  ) as DashboardColumnWidthsByViewport

  return {
    instances: orderedModules.map((moduleId) => ({
      instanceId: moduleId,
      moduleId,
      title: null,
      config: {},
    })),
    placements,
    columnWidths,
  }
}

export function defaultDashboardProfile(): DashboardProfile {
  return dashboardProfileForPreset(defaultDashboardPresetId)
}

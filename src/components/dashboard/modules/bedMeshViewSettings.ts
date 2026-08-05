import { configBoolean } from '@/dashboard/context'

/**
 * What the height map draws — each switch's key and default in one place,
 * shared by `BedMeshModule.vue` and `BedMeshViewSettingsFields.vue` so the two
 * cannot drift. Each pair used to live in both files, and a default changed in
 * one produces a settings row whose checkbox disagrees with the view it
 * controls, which is worse than either state alone.
 */
export const bedMeshViewDefaults = {
  showMeshLayer: true,
  showProbedLayer: false,
  showFlatLayer: false,
  wireframe: true,
  showProbes: true,
} as const

export type BedMeshViewSettingKey = keyof typeof bedMeshViewDefaults

/** Whether the height map draws the element, from this instance's stored configuration. */
export function readBedMeshViewSetting(
  config: Record<string, unknown>,
  key: BedMeshViewSettingKey,
): boolean {
  return configBoolean(config, key, bedMeshViewDefaults[key])
}

/**
 * The three height-map layers in the order the settings row draws them. They
 * share one row because they are one set — a reader picks among them, and
 * stacked as three rows they would push the card's quick layer past the four
 * the dashboard contract allows. That is also why they promote under one
 * `layers` key rather than three: a `check-set` behind a single descriptive
 * word cannot be promoted a third of the way.
 *
 * They are separate layers rather than one blended surface because they answer
 * different questions. The mesh is the correction the printer will apply; the
 * probed points are what it measured. Where the two disagree the interpolation
 * is smoothing over something — which is exactly what a user chasing a bad
 * first layer needs to see.
 */
export const bedMeshLayerRows = [
  { key: 'showMeshLayer', label: 'dashboard.bedMesh.layerMesh' },
  { key: 'showProbedLayer', label: 'dashboard.bedMesh.layerProbed' },
  { key: 'showFlatLayer', label: 'dashboard.bedMesh.layerFlat' },
] as const satisfies readonly { key: BedMeshViewSettingKey; label: string }[]

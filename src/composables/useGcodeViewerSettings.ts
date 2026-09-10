import { readonly, ref } from 'vue'

import {
  defaultGcodeTierCeiling,
  isGcodeRenderTier,
  type GcodeQualityMode,
} from '@/features/gcode/quality'
import type { GcodeRenderTier } from '@/features/gcode/scene'
import type { GcodeColorMode } from '@/features/gcode/types'

/*
 * The viewer's persisted state, split by what the value is *about*.
 *
 * Preferences — how someone likes to look at a toolpath — travel with the
 * user through ADR 0008's settings bundle, because the answer is the same on
 * every screen they own. Device facts do not: the tier this machine can hold
 * and whether its last parse died are answers about this browser on this
 * hardware, and carrying them to a phone would carry the wrong one.
 */
const colorModeStorageKey = 'alabaster.gcodeViewer.colorMode'
const showTravelsStorageKey = 'alabaster.gcodeViewer.showTravels'
const qualityModeStorageKey = 'alabaster.gcodeViewer.qualityMode'
const followByDefaultStorageKey = 'alabaster.gcodeViewer.followByDefault'
const nozzleDiameterStorageKey = 'alabaster.gcodeViewer.nozzleDiameter'
const tierCeilingStorageKey = 'alabaster.gcodeViewer.tierCeiling'

/*
 * Keys the viewer used to write and no longer does. Removed on first run so a
 * browser that has been through the old viewer does not keep three dead
 * entries forever: the two orbit-pivot settings needed a per-frame geometry
 * pick that the library-backed renderer does not do, and seam highlighting
 * was a property of shaders Alabaster no longer owns. ADR 0011 records both.
 */
const retiredStorageKeys = [
  'alabaster.gcodeViewer.orbitMode',
  'alabaster.gcodeViewer.snapToCenter',
  'alabaster.gcodeViewer.highlightSeams',
]

function readColorMode(): GcodeColorMode {
  const stored = localStorage.getItem(colorModeStorageKey)
  return stored === 'feature' || stored === 'feedrate' ? stored : 'single'
}

function readQualityMode(): GcodeQualityMode {
  const stored = localStorage.getItem(qualityModeStorageKey)
  return stored === 'quality' || stored === 'performance' ? stored : 'auto'
}

function readTierCeiling(): GcodeRenderTier {
  const stored = Number.parseInt(localStorage.getItem(tierCeilingStorageKey) ?? '', 10)
  return isGcodeRenderTier(stored) ? stored : defaultGcodeTierCeiling
}

/*
 * An override, not the source of truth. The viewer needs a bead width for moves
 * whose extruded volume cannot give one, and the printer already reports its
 * nozzle diameter — so this stays null until someone sets it, and null means
 * "use the machine's". It earns its place for local files inspected with no
 * printer connected, and for a machine whose config does not match its hardware.
 */
function readNozzleDiameter(): number | null {
  const stored = Number.parseFloat(localStorage.getItem(nozzleDiameterStorageKey) ?? '')
  return Number.isFinite(stored) && stored > 0 ? stored : null
}

for (const key of retiredStorageKeys) localStorage.removeItem(key)

const colorMode = ref<GcodeColorMode>(readColorMode())
const showTravels = ref(localStorage.getItem(showTravelsStorageKey) === 'true')
// Auto by default: the governor measures this machine rather than asking the
// user to guess for it, and the two manual modes exist for the cases a
// measurement cannot know about — a screenshot, or a deliberately frugal tab.
const qualityMode = ref<GcodeQualityMode>(readQualityMode())
// Following a running print is what most people open the viewer for, so it is
// on unless someone has turned it off.
const followByDefault = ref(localStorage.getItem(followByDefaultStorageKey) !== 'false')
const nozzleDiameterOverride = ref<number | null>(readNozzleDiameter())
const tierCeiling = ref<GcodeRenderTier>(readTierCeiling())

function setColorMode(mode: GcodeColorMode): void {
  colorMode.value = mode
  localStorage.setItem(colorModeStorageKey, mode)
}

function setShowTravels(enabled: boolean): void {
  showTravels.value = enabled
  localStorage.setItem(showTravelsStorageKey, String(enabled))
}

function setQualityMode(mode: GcodeQualityMode): void {
  qualityMode.value = mode
  localStorage.setItem(qualityModeStorageKey, mode)
}

function setFollowByDefault(enabled: boolean): void {
  followByDefault.value = enabled
  localStorage.setItem(followByDefaultStorageKey, String(enabled))
}

function setNozzleDiameterOverride(diameter: number | null): void {
  if (diameter === null || !Number.isFinite(diameter) || diameter <= 0) {
    nozzleDiameterOverride.value = null
    localStorage.removeItem(nozzleDiameterStorageKey)
    return
  }
  const clamped = Math.min(2, Math.max(0.1, diameter))
  nozzleDiameterOverride.value = clamped
  localStorage.setItem(nozzleDiameterStorageKey, String(clamped))
}

/**
 * Records that this device could not hold a tier, so the next load starts one
 * rung cheaper. Only ever moves downward within a session: a machine that
 * struggled once has told us something, while a machine that had one fast
 * minute has not, and a ceiling that could climb again would reintroduce the
 * stutter the user just watched us fix.
 */
function lowerTierCeiling(): GcodeRenderTier {
  const next = Math.max(1, tierCeiling.value - 1) as GcodeRenderTier
  tierCeiling.value = next
  localStorage.setItem(tierCeilingStorageKey, String(next))
  return next
}

function setTierCeiling(tier: GcodeRenderTier): void {
  tierCeiling.value = tier
  localStorage.setItem(tierCeilingStorageKey, String(tier))
}

export function useGcodeViewerSettings() {
  return {
    colorMode: readonly(colorMode),
    showTravels: readonly(showTravels),
    qualityMode: readonly(qualityMode),
    followByDefault: readonly(followByDefault),
    nozzleDiameterOverride: readonly(nozzleDiameterOverride),
    tierCeiling: readonly(tierCeiling),
    setColorMode,
    setShowTravels,
    setQualityMode,
    setFollowByDefault,
    setNozzleDiameterOverride,
    lowerTierCeiling,
    setTierCeiling,
  }
}

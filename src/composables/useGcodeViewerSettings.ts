import { readonly, ref } from 'vue'

import type { GcodeQualityMode } from '@/features/gcode/quality'

/**
 * Where the orbit pivot is placed when a rotation drag starts: on the point the
 * center of the view hits, or on the point under the pointer.
 */
export type GcodeOrbitMode = 'center' | 'pointer'

const orbitModeStorageKey = 'alabaster.gcodeViewer.orbitMode'
const snapToCenterStorageKey = 'alabaster.gcodeViewer.snapToCenter'
const highlightSeamsStorageKey = 'alabaster.gcodeViewer.highlightSeams'
const qualityModeStorageKey = 'alabaster.gcodeViewer.qualityMode'
const nozzleDiameterStorageKey = 'alabaster.gcodeViewer.nozzleDiameter'

function getInitialOrbitMode(): GcodeOrbitMode {
  return localStorage.getItem(orbitModeStorageKey) === 'pointer' ? 'pointer' : 'center'
}

const orbitMode = ref<GcodeOrbitMode>(getInitialOrbitMode())
const snapToCenter = ref(localStorage.getItem(snapToCenterStorageKey) === 'true')
const highlightSeams = ref(localStorage.getItem(highlightSeamsStorageKey) === 'true')

function getInitialQualityMode(): GcodeQualityMode {
  const stored = localStorage.getItem(qualityModeStorageKey)
  return stored === 'quality' || stored === 'performance' ? stored : 'auto'
}

// Auto by default: the governor measures this machine rather than asking the
// user to guess for it, and the two manual modes exist for the cases a
// measurement cannot know about — a screenshot, or a deliberately frugal tab.
const qualityMode = ref<GcodeQualityMode>(getInitialQualityMode())

/*
 * An override, not the source of truth. The viewer needs a bead width for moves
 * whose extruded volume cannot give one, and the printer already reports its
 * nozzle diameter — so this stays null until someone sets it, and null means
 * "use the machine's". It earns its place for local files inspected with no
 * printer connected, and for a machine whose config does not match its hardware.
 */
function getInitialNozzleDiameter(): number | null {
  const stored = Number.parseFloat(localStorage.getItem(nozzleDiameterStorageKey) ?? '')
  return Number.isFinite(stored) && stored > 0 ? stored : null
}

const nozzleDiameterOverride = ref<number | null>(getInitialNozzleDiameter())

function setOrbitMode(mode: GcodeOrbitMode): void {
  orbitMode.value = mode
  localStorage.setItem(orbitModeStorageKey, mode)
}

function setSnapToCenter(enabled: boolean): void {
  snapToCenter.value = enabled
  localStorage.setItem(snapToCenterStorageKey, String(enabled))
}

function setHighlightSeams(enabled: boolean): void {
  highlightSeams.value = enabled
  localStorage.setItem(highlightSeamsStorageKey, String(enabled))
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

function setQualityMode(mode: GcodeQualityMode): void {
  qualityMode.value = mode
  localStorage.setItem(qualityModeStorageKey, mode)
}

export function useGcodeViewerSettings() {
  return {
    orbitMode: readonly(orbitMode),
    snapToCenter: readonly(snapToCenter),
    highlightSeams: readonly(highlightSeams),
    qualityMode: readonly(qualityMode),
    nozzleDiameterOverride: readonly(nozzleDiameterOverride),
    setOrbitMode,
    setNozzleDiameterOverride,
    setSnapToCenter,
    setHighlightSeams,
    setQualityMode,
  }
}

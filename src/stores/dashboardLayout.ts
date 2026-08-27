import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  clampColumn,
  columnCountFor,
  dashboardModuleIds,
  dashboardViewports,
  defaultColumnForIndex,
  defaultColumnWidths,
  isDashboardColumnWidth,
  isDashboardModuleId,
  moduleIdOfInstance,
  movePlacement,
  nextInstanceId,
  renameStoredColumnWidth,
  renameStoredInstanceId,
  renameStoredModuleId,
  visibleIndexOf,
  type DashboardColumnWidth,
  type DashboardColumnWidths,
  type DashboardColumnWidthsByViewport,
  type DashboardDropTarget,
  type DashboardModuleId,
  type DashboardModuleInstance,
  type DashboardPlacement,
  type DashboardPlacements,
  type DashboardProfile,
  type DashboardViewport,
} from '@/dashboard/layout'
import {
  dashboardProfileForPreset,
  defaultDashboardProfile,
  presetVisibleModules,
  type DashboardPresetId,
} from '@/dashboard/presets'
import { isRecord } from '@/utils/records'

const storageKey = 'alabaster.dashboard.profiles.v3'
const legacySpanStorageKey = 'alabaster.dashboard.profiles.v2'
const legacyFlatStorageKey = 'alabaster.dashboard.layouts.v1'
const localScope = 'local'

export interface RenderedDashboardInstance {
  instance: DashboardModuleInstance
  placement: DashboardPlacement
}

interface StoredProfiles {
  version: 3
  scopes: Record<string, DashboardProfile>
}

function defaultVisibility(moduleId: DashboardModuleId): boolean {
  return presetVisibleModules('standard').includes(moduleId)
}

function normalizeInstances(value: unknown): DashboardModuleInstance[] {
  const candidates = Array.isArray(value) ? value : []
  const instances: DashboardModuleInstance[] = []
  const taken = new Set<string>()

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const storedInstanceId =
      typeof candidate.instanceId === 'string' ? candidate.instanceId.trim() : ''
    // Renamed before anything else looks at it: an id under its old name is
    // still this user's card, and every later step here resolves it to nothing.
    const instanceId = renameStoredInstanceId(storedInstanceId)
    if (instanceId === '' || taken.has(instanceId)) continue
    const storedModuleId = renameStoredModuleId(candidate.moduleId)
    const moduleId = isDashboardModuleId(storedModuleId)
      ? storedModuleId
      : moduleIdOfInstance(instanceId)
    if (!moduleId) continue

    taken.add(instanceId)
    instances.push({
      instanceId,
      moduleId,
      title:
        typeof candidate.title === 'string' && candidate.title.trim() !== ''
          ? candidate.title.trim()
          : null,
      config: isRecord(candidate.config) ? { ...candidate.config } : {},
    })
  }

  // Every registered module keeps an instance so the module tray can restore it.
  for (const moduleId of dashboardModuleIds) {
    if (instances.some((instance) => instance.moduleId === moduleId)) continue
    const instanceId = nextInstanceId(moduleId, taken)
    taken.add(instanceId)
    instances.push({ instanceId, moduleId, title: null, config: {} })
  }

  return instances
}

/**
 * A stored placement without a `column` predates the column layout (or came
 * from a span-based v2 profile); it falls back to a round-robin column by
 * position so nothing piles into column 0.
 */
function normalizePlacements(
  value: unknown,
  viewport: DashboardViewport,
  instances: readonly DashboardModuleInstance[],
): DashboardPlacement[] {
  const instancesById = new Map(instances.map((instance) => [instance.instanceId, instance]))
  const candidates = Array.isArray(value) ? value : []
  const placements: DashboardPlacement[] = []
  const placed = new Set<string>()

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const instanceId = renameStoredInstanceId(
      typeof candidate.instanceId === 'string' ? candidate.instanceId : '',
    )
    const instance = instancesById.get(instanceId)
    if (!instance || placed.has(instanceId)) continue

    placed.add(instanceId)
    placements.push({
      instanceId,
      column:
        clampColumn(candidate.column, viewport) ??
        defaultColumnForIndex(placements.length, viewport),
      visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
      collapsed: candidate.collapsed === true,
    })
  }

  for (const instance of instances) {
    if (placed.has(instance.instanceId)) continue
    placements.push({
      instanceId: instance.instanceId,
      column: defaultColumnForIndex(placements.length, viewport),
      visible: defaultVisibility(instance.moduleId),
      collapsed: false,
    })
  }

  return placements
}

/**
 * Stored column widths, in either shape they have been written in.
 *
 * Before every column could pick its own width the profile stored one
 * `{ shape, target }` pair: a single column nominated to be wider or narrower
 * than its equal siblings. Those two records describe the same geometry, so the
 * migration is a translation rather than a reset — `{ shape: 'wide', target: 1 }`
 * on desktop is exactly `['normal', 'wide', 'normal']`, and a dashboard someone
 * arranged before this change looks identical after it. That is the whole reason
 * the ratios in `columnWidthRatios` were kept at their old values.
 */
function normalizeColumnWidths(value: unknown, viewport: DashboardViewport): DashboardColumnWidths {
  const count = columnCountFor(viewport)

  if (Array.isArray(value)) {
    return Array.from({ length: count }, (_, index) => {
      const stored = renameStoredColumnWidth(value[index])
      return isDashboardColumnWidth(stored) ? stored : 'normal'
    })
  }

  if (isRecord(value) && (value.shape === 'wide' || value.shape === 'narrow')) {
    const widths = defaultColumnWidths(viewport)
    const target =
      typeof value.target === 'number' && Number.isFinite(value.target)
        ? Math.min(count - 1, Math.max(0, Math.round(value.target)))
        : 0
    const width = renameStoredColumnWidth(value.shape)
    if (isDashboardColumnWidth(width)) widths[target] = width
    return widths
  }

  return defaultColumnWidths(viewport)
}

export function normalizeDashboardProfile(value: unknown): DashboardProfile {
  if (!isRecord(value)) return defaultDashboardProfile()

  const instances = normalizeInstances(value.instances)
  const storedPlacements = isRecord(value.placements) ? value.placements : {}
  const placements = Object.fromEntries(
    dashboardViewports.map((viewport) => [
      viewport,
      normalizePlacements(storedPlacements[viewport], viewport, instances),
    ]),
  ) as DashboardPlacements

  const storedColumnWidths = isRecord(value.columnWidths) ? value.columnWidths : {}
  const columnWidths = Object.fromEntries(
    dashboardViewports.map((viewport) => [
      viewport,
      normalizeColumnWidths(storedColumnWidths[viewport], viewport),
    ]),
  ) as DashboardColumnWidthsByViewport

  return { instances, placements, columnWidths }
}

/**
 * Version 1 stored one flat list of module ids per viewport. Each of those ids
 * becomes the base instance of its module, and modules registered after the
 * upgrade follow the standard preset.
 */
export function migrateLegacyProfile(value: unknown): DashboardProfile | null {
  if (!isRecord(value)) return null

  const instances = normalizeInstances([])
  const placements = Object.fromEntries(
    dashboardViewports.map((viewport) => {
      const storedItems = Array.isArray(value[viewport]) ? (value[viewport] as unknown[]) : []
      const migrated: DashboardPlacement[] = []
      const placed = new Set<string>()

      for (const candidate of storedItems) {
        if (!isRecord(candidate)) continue
        const id = renameStoredModuleId(candidate.id)
        if (!isDashboardModuleId(id) || placed.has(id)) continue
        placed.add(id)
        migrated.push({
          instanceId: id,
          column: defaultColumnForIndex(migrated.length, viewport),
          visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
          collapsed: false,
        })
      }

      for (const instance of instances) {
        if (placed.has(instance.instanceId)) continue
        migrated.push({
          instanceId: instance.instanceId,
          column: defaultColumnForIndex(migrated.length, viewport),
          visible: defaultVisibility(instance.moduleId),
          collapsed: false,
        })
      }

      return [viewport, migrated]
    }),
  ) as DashboardPlacements

  const columnWidths = Object.fromEntries(
    dashboardViewports.map((viewport) => [viewport, defaultColumnWidths(viewport)]),
  ) as DashboardColumnWidthsByViewport

  return { instances, placements, columnWidths }
}

function readLegacyFlatStorage(): Record<string, DashboardProfile> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(legacyFlatStorageKey) ?? '') as unknown
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.scopes)) return {}

    const scopes: Record<string, DashboardProfile> = {}
    for (const [scope, value] of Object.entries(parsed.scopes)) {
      const migrated = migrateLegacyProfile(value)
      if (migrated) scopes[scope] = migrated
    }
    return scopes
  } catch {
    return {}
  }
}

function readLegacySpanStorage(): Record<string, DashboardProfile> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(legacySpanStorageKey) ?? '') as unknown
    if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.scopes)) return {}

    const scopes: Record<string, DashboardProfile> = {}
    for (const [scope, value] of Object.entries(parsed.scopes)) {
      scopes[scope] = normalizeDashboardProfile(value)
    }
    return scopes
  } catch {
    return {}
  }
}

function readStorage(): StoredProfiles {
  const legacyScopes = { ...readLegacyFlatStorage(), ...readLegacySpanStorage() }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '') as unknown
    if (!isRecord(parsed) || parsed.version !== 3 || !isRecord(parsed.scopes)) {
      return { version: 3, scopes: legacyScopes }
    }

    const scopes: Record<string, DashboardProfile> = { ...legacyScopes }
    for (const [scope, value] of Object.entries(parsed.scopes)) {
      scopes[scope] = normalizeDashboardProfile(value)
    }
    return { version: 3, scopes }
  } catch {
    return { version: 3, scopes: legacyScopes }
  }
}

export const useDashboardLayoutStore = defineStore('dashboardLayout', () => {
  const scope = ref(localScope)
  /**
   * Keys this profile may be stored under, the live one first. A profile written
   * before printers had identities sits under the endpoint, so it is read from
   * there once and written back under the id — see `printerScope.ts`.
   */
  const supersededScopes = ref<string[]>([])
  const profile = ref<DashboardProfile>(
    readStorage().scopes[localScope] ?? defaultDashboardProfile(),
  )

  const instancesById = computed(
    () => new Map(profile.value.instances.map((instance) => [instance.instanceId, instance])),
  )

  function persist(): void {
    const stored = readStorage()
    stored.scopes[scope.value] = profile.value
    // Whatever key this profile arrived under is now redundant, so it goes in the
    // same write. Left behind, a later printer could adopt it as its own.
    for (const key of supersededScopes.value) {
      if (key !== scope.value) delete stored.scopes[key]
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: 3, scopes: stored.scopes } satisfies StoredProfiles),
    )
  }

  /**
   * Seeds a newly added printer's dashboard from an existing one's, for "copy
   * over settings" when adding a printer. `fromScopeKeys` is read the same way
   * `selectPrinterScope` reads them — identity first, an older endpoint key as
   * fallback — and the first one with a stored profile wins.
   *
   * A pure storage operation, not routed through the live `profile`/`scope`
   * refs: the printer being added is never the one currently on screen, and
   * every mutator here already calls `persist()` immediately, so the source's
   * own edits are already in storage by the time this reads it.
   *
   * Assigning `source` straight into the target's slot does not alias the two
   * printers together: nothing here holds an object reference across scopes
   * for longer than this call, and the `JSON.stringify` below turns whatever
   * shape `source` has into an independent string the moment it is written —
   * a later edit to either printer's live profile starts from its own
   * `readStorage()` parse, never from this in-memory value.
   */
  function copyProfileFrom(fromScopeKeys: readonly string[], toScope: string): void {
    const target = toScope.trim()
    if (target === '') return

    const stored = readStorage()
    const sourceKey = fromScopeKeys.find(
      (key) => key.trim() !== '' && stored.scopes[key] !== undefined,
    )
    const source = sourceKey ? stored.scopes[sourceKey] : undefined
    if (!source) return

    stored.scopes[target] = source
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: 3, scopes: stored.scopes } satisfies StoredProfiles),
    )
  }

  /**
   * `scopeKeys` is the printer's identity followed by any older key its profile
   * may still live under, which is what `usePrintersStore().activeScopeKeys`
   * provides. Passing a bare string still works and means "only this key".
   */
  function selectPrinterScope(scopeKeys: string | readonly string[]): void {
    const candidates = (typeof scopeKeys === 'string' ? [scopeKeys] : scopeKeys)
      .map((key) => key.trim())
      .filter((key) => key !== '')
    const [preferred = localScope, ...rest] = candidates
    if (scope.value === preferred && supersededScopes.value.join() === rest.join()) return

    scope.value = preferred
    supersededScopes.value = rest
    const stored = readStorage()
    const existing = candidates
      .map((key) => stored.scopes[key])
      .find((candidate) => candidate !== undefined)
    profile.value = existing ?? defaultDashboardProfile()
  }

  function itemsFor(viewport: DashboardViewport): RenderedDashboardInstance[] {
    return profile.value.placements[viewport].flatMap((placement) => {
      const instance = instancesById.value.get(placement.instanceId)
      return instance ? [{ instance, placement }] : []
    })
  }

  function columnWidthsFor(viewport: DashboardViewport): DashboardColumnWidths {
    return profile.value.columnWidths[viewport]
  }

  function instanceCountFor(moduleId: DashboardModuleId): number {
    return profile.value.instances.filter((instance) => instance.moduleId === moduleId).length
  }

  function updatePlacements(
    viewport: DashboardViewport,
    update: (placements: DashboardPlacement[]) => DashboardPlacement[],
  ): void {
    profile.value = {
      ...profile.value,
      placements: {
        ...profile.value.placements,
        [viewport]: update([...profile.value.placements[viewport]]),
      },
    }
    persist()
  }

  function updatePlacement(
    viewport: DashboardViewport,
    instanceId: string,
    update: (placement: DashboardPlacement) => DashboardPlacement,
  ): void {
    updatePlacements(viewport, (placements) =>
      placements.map((placement) =>
        placement.instanceId === instanceId ? update(placement) : placement,
      ),
    )
  }

  function setVisible(viewport: DashboardViewport, instanceId: string, visible: boolean): void {
    updatePlacement(viewport, instanceId, (placement) => ({ ...placement, visible }))
  }

  function setCollapsed(viewport: DashboardViewport, instanceId: string, collapsed: boolean): void {
    updatePlacement(viewport, instanceId, (placement) => ({ ...placement, collapsed }))
  }

  function toggleCollapsed(viewport: DashboardViewport, instanceId: string): void {
    updatePlacement(viewport, instanceId, (placement) => ({
      ...placement,
      collapsed: !placement.collapsed,
    }))
  }

  /**
   * Sets one column's width. Per column rather than per profile because that is
   * the only edit the picker makes, and routing it through the array's own
   * normalizer keeps a stale index or an unknown name from reaching storage.
   */
  function setColumnWidth(
    viewport: DashboardViewport,
    column: number,
    width: DashboardColumnWidth,
  ): void {
    const index = clampColumn(column, viewport)
    if (index === null || !isDashboardColumnWidth(width)) return

    const widths = [...profile.value.columnWidths[viewport]]
    widths[index] = width
    profile.value = {
      ...profile.value,
      columnWidths: {
        ...profile.value.columnWidths,
        [viewport]: normalizeColumnWidths(widths, viewport),
      },
    }
    persist()
  }

  /**
   * Lands a card at an explicit slot: the column, and the index among that
   * column's visible cards. This is what a drop commits, and it is the same
   * call the drag preview runs to decide what to show — so what the user sees
   * mid-drag and what they get on release cannot come apart.
   */
  function moveTo(
    viewport: DashboardViewport,
    instanceId: string,
    target: DashboardDropTarget,
  ): void {
    updatePlacements(viewport, (placements) =>
      movePlacement(placements, viewport, instanceId, target),
    )
  }

  /**
   * Reordering always adopts the target's column, so dropping a card onto
   * another column's card both reorders and moves it in one gesture.
   *
   * The target has to be a card the user can see. A hidden placement has no
   * position on screen to land beside, so ordering against one would move the
   * source to a slot nothing on the dashboard explains.
   */
  function reorder(viewport: DashboardViewport, sourceId: string, targetId: string): void {
    if (sourceId === targetId) return
    const placements = profile.value.placements[viewport]
    const sourceIndex = placements.findIndex((placement) => placement.instanceId === sourceId)
    const targetIndex = placements.findIndex((placement) => placement.instanceId === targetId)
    const target = placements[targetIndex]
    if (sourceIndex < 0 || !target || !target.visible) return

    /*
     * Dragging something later in the list past its target has to land *after*
     * the target, or dropping onto the very next card is a no-op — it would
     * just get spliced back into the slot it already occupies.
     */
    const movingLater = sourceIndex < targetIndex
    const withoutSource = placements.filter((placement) => placement.instanceId !== sourceId)
    const index = visibleIndexOf(withoutSource, targetId)
    moveTo(viewport, sourceId, { column: target.column, index: index + (movingLater ? 1 : 0) })
  }

  /**
   * Moves within the same column: adjacency is computed among the instance's
   * *visible* column siblings, not the flat placement order, so this never
   * jumps columns and never spends a press stepping over a hidden card the
   * user cannot see move.
   */
  function move(viewport: DashboardViewport, instanceId: string, direction: -1 | 1): void {
    const placements = profile.value.placements[viewport]
    const current = placements.find((placement) => placement.instanceId === instanceId)
    if (!current) return
    const siblings = placements.filter(
      (placement) => placement.column === current.column && placement.visible,
    )
    const siblingIndex = siblings.findIndex((placement) => placement.instanceId === instanceId)
    const target = siblings[siblingIndex + direction]
    if (siblingIndex < 0 || !target) return
    reorder(viewport, instanceId, target.instanceId)
  }

  /**
   * Moves the card into an adjacent column via keyboard/tap controls, as a
   * drag-and-drop alternative. It keeps the row it was standing in, clamped to
   * the length of the column it arrives in: previously it kept its slot in the
   * flat list instead, so it surfaced at whatever position that happened to be
   * among the new column's cards, and pressing left then right did not put it
   * back where it started.
   */
  function moveColumn(viewport: DashboardViewport, instanceId: string, direction: -1 | 1): void {
    const placements = profile.value.placements[viewport]
    const current = placements.find((placement) => placement.instanceId === instanceId)
    if (!current) return
    const column = clampColumn(current.column + direction, viewport) ?? current.column
    if (column === current.column) return
    moveTo(viewport, instanceId, { column, index: visibleIndexOf(placements, instanceId) })
  }

  function updateConfig(instanceId: string, patch: Record<string, unknown>): void {
    profile.value = {
      ...profile.value,
      instances: profile.value.instances.map((instance) =>
        instance.instanceId === instanceId
          ? { ...instance, config: { ...instance.config, ...patch } }
          : instance,
      ),
    }
    persist()
  }

  function renameInstance(instanceId: string, title: string): void {
    const trimmedTitle = title.trim()
    profile.value = {
      ...profile.value,
      instances: profile.value.instances.map((instance) =>
        instance.instanceId === instanceId
          ? { ...instance, title: trimmedTitle === '' ? null : trimmedTitle }
          : instance,
      ),
    }
    persist()
  }

  /**
   * A duplicate exists in every viewport so its configuration is reachable on
   * any screen; only the active viewport reveals it immediately.
   *
   * `emptyConfig` makes the copy a fresh card rather than a twin — same module,
   * same placement beside its source, nothing configured. It exists for
   * grouping: a second Macros card is a new group, and a group that starts
   * with the first group's macros copied in has to be emptied before it can
   * be filled.
   */
  function duplicateInstance(
    viewport: DashboardViewport,
    instanceId: string,
    options?: { emptyConfig?: boolean },
  ): string | null {
    const source = instancesById.value.get(instanceId)
    if (!source) return null

    const duplicateId = nextInstanceId(
      source.moduleId,
      profile.value.instances.map((instance) => instance.instanceId),
    )
    const duplicate: DashboardModuleInstance = {
      instanceId: duplicateId,
      moduleId: source.moduleId,
      title: null,
      config: options?.emptyConfig ? {} : { ...source.config },
    }

    const placements = Object.fromEntries(
      dashboardViewports.map((candidate) => {
        const current = [...profile.value.placements[candidate]]
        const sourceIndex = current.findIndex((placement) => placement.instanceId === instanceId)
        const sourcePlacement = current[sourceIndex]
        const placement: DashboardPlacement = {
          instanceId: duplicateId,
          column: sourcePlacement?.column ?? defaultColumnForIndex(current.length, candidate),
          visible: candidate === viewport ? true : (sourcePlacement?.visible ?? false),
          collapsed: false,
        }
        current.splice(sourceIndex < 0 ? current.length : sourceIndex + 1, 0, placement)
        return [candidate, current]
      }),
    ) as DashboardPlacements

    profile.value = {
      instances: [...profile.value.instances, duplicate],
      placements,
      columnWidths: profile.value.columnWidths,
    }
    persist()
    return duplicateId
  }

  function removeInstance(instanceId: string): void {
    const instance = instancesById.value.get(instanceId)
    if (!instance || instanceCountFor(instance.moduleId) <= 1) return

    const placements = Object.fromEntries(
      dashboardViewports.map((viewport) => [
        viewport,
        profile.value.placements[viewport].filter(
          (placement) => placement.instanceId !== instanceId,
        ),
      ]),
    ) as DashboardPlacements

    profile.value = {
      instances: profile.value.instances.filter((candidate) => candidate.instanceId !== instanceId),
      placements,
      columnWidths: profile.value.columnWidths,
    }
    persist()
  }

  function applyPreset(preset: DashboardPresetId): void {
    const presetProfile = dashboardProfileForPreset(preset)
    const configuredInstances = new Map(
      profile.value.instances.map((instance) => [instance.instanceId, instance]),
    )

    // Presets change placement, not the work a module instance is configured
    // for, and not the column-width shape the user already picked.
    profile.value = {
      instances: presetProfile.instances.map(
        (instance) => configuredInstances.get(instance.instanceId) ?? instance,
      ),
      placements: presetProfile.placements,
      columnWidths: profile.value.columnWidths,
    }
    persist()
  }

  /**
   * Replaces the active scope's whole profile in one write — import and
   * Moonraker-DB restore (`src/settings/bundle.ts`) both hand over a
   * complete profile rather than editing placements or instances one at a
   * time, so this goes through the same `normalizeDashboardProfile` every
   * other read path does rather than trusting the input's shape.
   */
  function replaceProfile(value: unknown): void {
    profile.value = normalizeDashboardProfile(value)
    persist()
  }

  function reset(viewport: DashboardViewport): void {
    const ordered = dashboardModuleIds.flatMap((moduleId) =>
      profile.value.instances.filter((instance) => instance.moduleId === moduleId),
    )
    updatePlacements(viewport, () =>
      ordered.map((instance, index) => ({
        instanceId: instance.instanceId,
        column: defaultColumnForIndex(index, viewport),
        visible: defaultVisibility(instance.moduleId),
        collapsed: false,
      })),
    )
    profile.value = {
      ...profile.value,
      columnWidths: {
        ...profile.value.columnWidths,
        [viewport]: defaultColumnWidths(viewport),
      },
    }
    persist()
  }

  return {
    scope,
    profile,
    selectPrinterScope,
    copyProfileFrom,
    itemsFor,
    columnWidthsFor,
    instanceCountFor,
    setVisible,
    setCollapsed,
    toggleCollapsed,
    setColumnWidth,
    moveTo,
    reorder,
    move,
    moveColumn,
    updateConfig,
    renameInstance,
    duplicateInstance,
    removeInstance,
    applyPreset,
    replaceProfile,
    reset,
  }
})

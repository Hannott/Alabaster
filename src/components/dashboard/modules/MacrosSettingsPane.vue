<script setup lang="ts">
import { computed, nextTick, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import {
  macroColorKey,
  macroColorVariable,
  nextMacroColorKey,
} from '@/components/dashboard/modules/macroColors'
import MacrosCardSettingsFields from '@/components/dashboard/modules/MacrosCardSettingsFields.vue'
import {
  printStates,
  type PrintVisibilityState,
} from '@/components/dashboard/modules/macroVisibility'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import {
  configBoolean,
  configStringList,
  configStringMap,
  useDashboardModule,
  useDashboardSurfaceGroupSwitch,
} from '@/dashboard/context'
import { createDividerId, dividerId, makeDividerEntry } from '@/dashboard/macroDividers'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { formatMacroLabel, useMacrosStore } from '@/stores/macros'

/**
 * What the Macros card draws, then which macros it carries and in what order.
 *
 * The picker is the bulk of the module's configuration, and it is a picker
 * rather than a handful of rows — far too much for a layer that opens inside
 * the card it is filling. Docked beside it, the card gains and loses buttons as
 * they are chosen, which is the only honest way to judge whether a group is the
 * right size.
 *
 * Nothing in this pane may be shaped like a macro button. The docked card
 * stands beside it, live — its buttons really run G-code — and this pane once
 * drew the available macros as the same mono buttons, so a press that adds and
 * a press that fires the printer looked identical twenty pixels apart. Both
 * lists are rows: the name, then explicit controls.
 */
interface MacroButton {
  name: string
  label: string
  isMissing: boolean
}

interface SelectedMacroRow {
  kind: 'macro'
  /** The raw `macros` order-list entry — the macro name itself. */
  entry: string
  name: string
  label: string
  isMissing: boolean
  colorVariable: string | null
  colorLabel: string
  visibility: Record<PrintVisibilityState, boolean>
  accessibleLabel: string
}

/** A section heading row — see `dashboard/macroDividers.ts`. It carries no
 * macro identity, so it skips color, visibility, and the missing badge. */
interface SelectedDividerRow {
  kind: 'divider'
  /** The raw `macros` order-list entry — the `divider::<id>` marker. */
  entry: string
  id: string
  label: string
  accessibleLabel: string
}

type SelectedRow = SelectedMacroRow | SelectedDividerRow

const { t } = useI18n({ useScope: 'global' })
const macros = useMacrosStore()
const layout = useDashboardLayoutStore()
const { viewport } = useDashboardViewport()
const { config, updateConfig, instanceId } = useDashboardModule('macros')
const switchGroup = useDashboardSurfaceGroupSwitch()
const query = ref('')

/**
 * Whether the whole card shows while the printer is in each state — the same
 * three states a macro's own row offers, one level up. All default to shown:
 * a card that appeared only after someone opted in per state would silently
 * vanish for every dashboard carried over from before this setting existed.
 */
const groupVisibilityKey: Record<PrintVisibilityState, string> = {
  standby: 'showInStandby',
  paused: 'showInPause',
  printing: 'showInPrinting',
}

function groupVisibleFor(state: PrintVisibilityState): boolean {
  return configBoolean(config.value, groupVisibilityKey[state], true)
}

function toggleGroupVisibility(state: PrintVisibilityState): void {
  updateConfig({ [groupVisibilityKey[state]]: !groupVisibleFor(state) })
}

/** The per-macro equivalent, keyed by config list rather than by boolean: a
 * macro not named in the list is shown, matching the group default above. */
const hiddenKey: Record<PrintVisibilityState, string> = {
  standby: 'hiddenInStandby',
  paused: 'hiddenInPaused',
  printing: 'hiddenInPrinting',
}

function macroVisibleFor(name: string, state: PrintVisibilityState): boolean {
  return !configStringList(config.value, hiddenKey[state]).includes(name)
}

function toggleMacroVisibility(name: string, state: PrintVisibilityState): void {
  const key = hiddenKey[state]
  const hidden = configStringList(config.value, key)
  const next = hidden.includes(name) ? hidden.filter((entry) => entry !== name) : [...hidden, name]
  updateConfig({ [key]: next })
}

/**
 * Every macros instance, so a mixed set of macros can be split into named
 * groups — one card per subsystem — without leaving this pane. "Active" is
 * simply which instance is currently docked: the pane only ever renders for
 * that one, `+` always adds to it, and `SettingsSurface` remounts this whole
 * component on switch (its host is keyed by instance id), so there is nothing
 * to resync when the active group changes.
 */
const groups = computed(() =>
  layout.profile.instances
    .filter((instance) => instance.moduleId === 'macros')
    .map((instance) => ({
      instanceId: instance.instanceId,
      title: instance.title ?? t('dashboard.modules.macros'),
    })),
)

function selectGroup(targetId: string): void {
  if (targetId === instanceId) return
  switchGroup?.(targetId)
}

/**
 * Seeded once per mount rather than bound straight to the stored title: typing
 * commits on `change`, so this is the same draft pattern every other
 * type-while-live field in the app uses — see "A field renders from a draft"
 * in interface-standards.md. Nothing else can rename this instance out from
 * under the field while the pane is open, so there is no live value to guard
 * against, only the general rule to follow.
 */
const titleDraft = ref(groups.value.find((group) => group.instanceId === instanceId)?.title ?? '')

function commitTitle(): void {
  layout.renameInstance(instanceId, titleDraft.value)
}

/**
 * Grouping is one card per group, per the module contract — so "make a group"
 * is "make another card", here where the grouping is being thought about,
 * instead of behind Customize. The new card starts empty: it is a new group,
 * not a twin of this one, and switching straight to it is what a "New" action
 * is expected to do — the picker for naming and filling it is right here.
 */
function createCard(): void {
  const newId = layout.duplicateInstance(viewport.value, instanceId, { emptyConfig: true })
  if (newId) switchGroup?.(newId)
}

const selection = computed(() => configStringList(config.value, 'macros'))
const colors = computed(() => configStringMap(config.value, 'colors'))
const dividerLabels = computed(() => configStringMap(config.value, 'dividerLabels'))

const selectedRows = computed<SelectedRow[]>(() =>
  selection.value.map((entry): SelectedRow => {
    const id = dividerId(entry)
    if (id !== null) {
      const label = dividerLabels.value[id] ?? ''
      return {
        kind: 'divider',
        entry,
        id,
        label,
        accessibleLabel: label || t('dashboard.macros.untitledDivider'),
      }
    }
    const name = entry
    const colorKey = macroColorKey(name, colors.value)
    const label = formatMacroLabel(name)
    return {
      kind: 'macro',
      entry,
      name,
      label,
      isMissing: macros.isMissing(name),
      colorVariable: macroColorVariable(name, colors.value),
      colorLabel: colorKey
        ? t(`dashboard.macros.color.${colorKey}`)
        : t('dashboard.macros.colorNone'),
      visibility: Object.fromEntries(
        printStates.map((state) => [state, macroVisibleFor(name, state)]),
      ) as Record<PrintVisibilityState, boolean>,
      accessibleLabel: label,
    }
  }),
)
/**
 * Underscores and spaces are one separator: the list renders CHAMBER LIGHT
 * TOGGLE while the printer calls it CHAMBER_LIGHT_TOGGLE, and a search that
 * only matches one spelling cannot find a macro by the name on the screen.
 */
function searchable(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, ' ')
}

const availableMacros = computed<MacroButton[]>(() => {
  const search = searchable(query.value)
  return macros.discovered
    .filter((name) => !selection.value.includes(name))
    .filter((name) => search === '' || searchable(name).includes(search))
    .map((name) => ({ name, label: formatMacroLabel(name), isMissing: false }))
})

// Nothing to choose from until the printer has been asked what it defines, and
// opening this pane is the first moment anybody needs the list.
onMounted(() => {
  if (!macros.hasDiscovered) void macros.refresh()
})

function select(name: string): void {
  if (selection.value.includes(name)) return
  updateConfig({ macros: [...selection.value, name] })
}

/** Removes any order-list entry — a macro name or a `divider::<id>` marker
 * alike, since both are just strings in the same list. */
function deselect(entry: string): void {
  updateConfig({ macros: selection.value.filter((candidate) => candidate !== entry) })
}

/**
 * One click cycles to the next hue and wraps back to none — see
 * `nextMacroColorKey` for why a cycle needs no separate "clear" control.
 */
function cycleColor(name: string): void {
  const next = nextMacroColorKey(macroColorKey(name, colors.value))
  const nextColors = { ...colors.value }
  if (next) nextColors[name] = next
  else delete nextColors[name]
  updateConfig({ colors: nextColors })
}

/** Reorders any order-list entry by one step — a macro name or a section
 * heading, since a heading rides the exact same list and the exact same
 * up/down keyboard-and-touch path as a macro does. */
function move(entry: string, direction: -1 | 1): void {
  const index = selection.value.indexOf(entry)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= selection.value.length) return
  const next = [...selection.value]
  const [moved] = next.splice(index, 1)
  if (!moved) return
  next.splice(targetIndex, 0, moved)
  updateConfig({ macros: next })
}

/**
 * A section heading's text lives in `dividerLabels`, keyed by id, never in
 * the order-list entry itself — so retyping it can never change its position
 * or collide with another entry's exact string. An emptied heading drops its
 * key entirely rather than storing `''`, matching `configStringMap`'s own
 * read-side rule that an empty value is indistinguishable from an absent one.
 */
function commitDividerLabel(id: string, value: string): void {
  const next = { ...dividerLabels.value }
  if (value.trim()) next[id] = value
  else delete next[id]
  updateConfig({ dividerLabels: next })
}

/**
 * Newly added inputs register themselves here so `addDivider` can focus the
 * one it just created — the pane otherwise has no way to reach a specific
 * row's `<input>` from a `v-for` whose length just changed.
 */
const dividerInputs = new Map<string, HTMLInputElement>()

function setDividerInputRef(id: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLInputElement) dividerInputs.set(id, el)
  else dividerInputs.delete(id)
}

/** Appends an empty heading to the end of the list, focused and ready to
 * type — dragging or the arrow buttons then move it wherever it should split
 * the list, the same way adding a macro starts at the end too. */
function addDivider(): void {
  const id = createDividerId()
  updateConfig({ macros: [...selection.value, makeDividerEntry(id)] })
  void nextTick(() => dividerInputs.get(id)?.focus())
}

/**
 * Native HTML5 drag, the same mechanism Configuration already uses for
 * dropping a file onto a folder — reusing an existing pattern rather than
 * introducing a third drag mechanism, per interface-standards.md's rule on
 * why the dashboard and Configuration use different ones. It fires nothing
 * for touch, and a `draggable` element is not reliably keyboard-operable
 * either, which is exactly why the quiet move-earlier/move-later buttons stay
 * — they are the keyboard and touch path, drag is the fast path for a mouse.
 *
 * An earlier version live-spliced a working copy of the order on every
 * `dragover`, the same "show the result, not a hint at it" the dashboard's
 * own card drag follows for `previewPlacements` — but that drag is pointer-
 * driven, not a native one. Reordering the `v-for`'s keyed DOM live moves the
 * row still under the browser's native drag session, and doing that mid-drag
 * is what silently dropped the operation before `drop` ever fired: the row
 * would visibly reorder and the profile would never update, which is exactly
 * the bug reported ("drag doesn't save, only the buttons do"). Native drag and
 * a live-reordering DOM don't mix; the dashboard's drag gets away with it only
 * because nothing there is a native browser drag to interrupt.
 *
 * The DOM now stays put for the whole drag. `dropTargetEntry` only tracks the
 * hovered row for the highlight and for `preventDefault`, which is what keeps
 * the browser treating the row as a valid drop target — the actual reorder is
 * computed once, from the untouched committed order, in `onDrop`. A section
 * heading drags exactly like a macro does: both are just entries in the same
 * order list, identified by the raw string rather than a display name.
 */
const draggingEntry = ref<string | null>(null)
const dropTargetEntry = ref<string | null>(null)

function onDragStart(entry: string, event: DragEvent): void {
  draggingEntry.value = entry
  dropTargetEntry.value = null
  event.dataTransfer?.setData('text/plain', entry)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(hoveredEntry: string, event: DragEvent): void {
  if (!draggingEntry.value || draggingEntry.value === hoveredEntry) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetEntry.value = hoveredEntry
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const dragged = draggingEntry.value
  const target = dropTargetEntry.value
  if (dragged && target && dragged !== target) {
    const order = [...selection.value]
    const from = order.indexOf(dragged)
    const to = order.indexOf(target)
    if (from >= 0 && to >= 0) {
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved as string)
      updateConfig({ macros: order })
    }
  }
  draggingEntry.value = null
  dropTargetEntry.value = null
}

function onDragEnd(): void {
  // A drop already committed and cleared both refs; this only runs the
  // cleanup for a drag that ended without one (dropped outside the list,
  // or cancelled), which must not leave a stale highlight on screen.
  draggingEntry.value = null
  dropTargetEntry.value = null
}
</script>

<template>
  <SurfaceSection :title="t('dashboard.macros.groupsTitle')">
    <div class="macro-groups">
      <AppButton
        v-for="group in groups"
        :key="group.instanceId"
        size="sm"
        :label="group.title"
        :aria-current="group.instanceId === instanceId"
        :title="
          group.instanceId === instanceId
            ? undefined
            : t('dashboard.macros.switchToGroup', { group: group.title })
        "
        @click="selectGroup(group.instanceId)"
      />
      <AppButton size="sm" icon="add" :label="t('dashboard.macros.addGroup')" @click="createCard" />
    </div>
  </SurfaceSection>

  <SurfaceSection bare>
    <!--
      Both are ordinary settings rows, so they keep the same rhythm and the same
      label type as the pinned row below them. They used to borrow
      `.surface-section__subtitle` for their words, which is the class that names
      a *group* of rows — two rows each headed as though they led a group of
      their own.

      The first is no longer a `<label>` wrapping the whole row either: a
      `.settings-row` stretches its leading track to the panel's full width, and
      a wrapping label forwards a click from that dead space into the input. The
      words keep the association through `for`, which is what they were there
      for in the first place.
    -->
    <div class="settings-row mt-4">
      <label class="settings-row__label" for="macro-group-title">
        {{ t('dashboard.macros.titleLabel') }}
      </label>
      <input
        id="macro-group-title"
        v-model="titleDraft"
        type="text"
        class="field"
        :placeholder="t('dashboard.modules.macros')"
        @change="commitTitle"
      />
    </div>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.macros.groupVisibilityTitle') }}</span>
      <div class="macro-visibility">
        <AppButton
          v-for="state in printStates"
          :key="state"
          variant="quiet"
          size="xs"
          icon-only
          :icon="state === 'standby' ? 'moon' : state === 'paused' ? 'pause' : 'print'"
          :aria-pressed="groupVisibleFor(state)"
          :title="t(`dashboard.macros.visibility.${state}`)"
          :aria-label="t(`dashboard.macros.visibility.${state}`)"
          @click="toggleGroupVisibility(state)"
        />
      </div>
    </div>
    <MacrosCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection bare>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <label class="sr-only" for="dashboard-macro-search">
        {{ t('dashboard.macros.searchLabel') }}
      </label>
      <input
        id="dashboard-macro-search"
        v-model="query"
        type="search"
        class="field field--on-soft macro-search"
        :placeholder="t('dashboard.macros.searchLabel')"
      />
      <AppButton
        size="sm"
        icon="refresh"
        :disabled="macros.isLoading"
        :title="t('dashboard.macros.refresh')"
        :aria-label="t('dashboard.macros.refresh')"
        @click="macros.refresh()"
      />
    </div>

    <p class="surface-section__subtitle">{{ t('dashboard.macros.selectedTitle') }}</p>
    <ul v-if="selectedRows.length > 0" class="macro-picker__selected mt-2 grid gap-1">
      <li
        v-for="(row, index) in selectedRows"
        :key="row.entry"
        class="macro-row macro-row--selected"
        :class="{
          'macro-row--divider': row.kind === 'divider',
          'macro-row--dragging': draggingEntry === row.entry,
          'macro-row--drop-target': draggingEntry && dropTargetEntry === row.entry,
        }"
        draggable="true"
        @dragstart="onDragStart(row.entry, $event)"
        @dragover="onDragOver(row.entry, $event)"
        @drop="onDrop($event)"
        @dragend="onDragEnd"
      >
        <AppIcon name="drag" class="size-4 shrink-0 text-muted" aria-hidden="true" />

        <template v-if="row.kind === 'macro'">
          <button
            type="button"
            class="macro-row__color"
            :class="{ 'macro-row__color--none': !row.colorVariable }"
            :style="row.colorVariable ? { '--swatch': row.colorVariable } : undefined"
            :title="t('dashboard.macros.colorCycle', { macro: row.label, color: row.colorLabel })"
            :aria-label="
              t('dashboard.macros.colorCycle', { macro: row.label, color: row.colorLabel })
            "
            @click="cycleColor(row.name)"
          ></button>
          <span class="macro-row__name text-mono-name">{{ row.label }}</span>
          <span v-if="row.isMissing" class="shrink-0 text-[0.68rem] font-bold text-muted">
            {{ t('dashboard.macros.missingShort') }}
          </span>
          <div class="macro-visibility">
            <AppButton
              v-for="state in printStates"
              :key="state"
              variant="quiet"
              size="xs"
              icon-only
              :icon="state === 'standby' ? 'moon' : state === 'paused' ? 'pause' : 'print'"
              :aria-pressed="row.visibility[state]"
              :title="t(`dashboard.macros.visibility.${state}`)"
              :aria-label="
                t('dashboard.macros.visibilityFor', {
                  macro: row.label,
                  state: t(`dashboard.macros.visibility.${state}`),
                })
              "
              @click="toggleMacroVisibility(row.name, state)"
            />
          </div>
        </template>

        <template v-else>
          <label class="sr-only" :for="`macro-divider-${row.id}`">
            {{ t('dashboard.macros.dividerLabelField') }}
          </label>
          <input
            :id="`macro-divider-${row.id}`"
            :ref="(el) => setDividerInputRef(row.id, el)"
            type="text"
            class="field field--sm macro-row__divider-input"
            :value="row.label"
            :placeholder="t('dashboard.macros.dividerLabelField')"
            @change="commitDividerLabel(row.id, ($event.target as HTMLInputElement).value)"
          />
        </template>

        <AppButton
          variant="danger-quiet"
          size="xs"
          icon-only
          icon="trash"
          :title="t('dashboard.macros.remove', { macro: row.accessibleLabel })"
          :aria-label="t('dashboard.macros.remove', { macro: row.accessibleLabel })"
          @click="deselect(row.entry)"
        />
        <!--
          Not a shortcut layered beside the primary mechanism — the keyboard
          and touch path for it. Drag is the mouse's way to reorder a row;
          neither a `draggable` element nor a native drag gesture is reliably
          operable by either, so these quietly stay the accessible fallback.
        -->
        <div class="macro-row__reorder">
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="up"
            :disabled="index === 0"
            :title="t('dashboard.macros.moveEarlier', { macro: row.accessibleLabel })"
            :aria-label="t('dashboard.macros.moveEarlier', { macro: row.accessibleLabel })"
            @click="move(row.entry, -1)"
          />
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="down"
            :disabled="index === selectedRows.length - 1"
            :title="t('dashboard.macros.moveLater', { macro: row.accessibleLabel })"
            :aria-label="t('dashboard.macros.moveLater', { macro: row.accessibleLabel })"
            @click="move(row.entry, 1)"
          />
        </div>
      </li>
    </ul>
    <p v-else class="mt-2 text-xs text-muted">{{ t('dashboard.macros.noneSelected') }}</p>

    <div class="macro-picker__rule"></div>

    <div class="macro-picker__available-header">
      <p class="surface-section__subtitle">{{ t('dashboard.macros.availableTitle') }}</p>
      <AppButton
        size="sm"
        icon="add"
        :label="t('dashboard.macros.addDivider')"
        @click="addDivider"
      />
    </div>
    <ul v-if="availableMacros.length > 0" class="macro-picker__available mt-2 grid gap-1">
      <li v-for="macro in availableMacros" :key="macro.name" class="macro-row">
        <span class="macro-row__name text-mono-name">{{ macro.label }}</span>
        <AppButton
          variant="quiet"
          size="xs"
          icon-only
          icon="add"
          :title="t('dashboard.macros.add', { macro: macro.label })"
          :aria-label="t('dashboard.macros.add', { macro: macro.label })"
          @click="select(macro.name)"
        />
      </li>
    </ul>
    <p v-if="availableMacros.length === 0" class="mt-2 text-xs text-muted">
      {{
        macros.discovered.length === 0
          ? t('dashboard.macros.noneReported')
          : t('dashboard.macros.noMatches')
      }}
    </p>
  </SurfaceSection>
</template>

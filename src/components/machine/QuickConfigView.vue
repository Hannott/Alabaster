<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import QuickConfigOptionDialog from '@/components/machine/QuickConfigOptionDialog.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useDashboardCardDrag } from '@/composables/useDashboardCardDrag'
import type { QuickConfigField, UnappliedChange } from '@/features/config/quickConfigFields'
import { moveQuickConfigCard, slotOf } from '@/features/config/quickConfigLayout'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { usePrinterStore } from '@/stores/printer'
import { useQuickConfigStore } from '@/stores/quickConfig'

const emit = defineEmits<{ openLocation: [path: string, line: number] }>()

const { t } = useI18n({ useScope: 'global' })
const quickConfig = useQuickConfigStore()
const machineFiles = useMachineFilesStore()
const printer = usePrinterStore()
const confirmations = useConfirmationsStore()
const { availability: moonrakerAvailability } = useAvailability('moonraker')
const { availability: klipperAvailability } = useAvailability('klipper')

const pendingDiscard = ref(false)
const pickerOpen = ref(false)
const pickerSection = ref<string | null>(null)
const pendingSaveAllAndRestart = ref(false)

const hasUnsaved = computed(() => quickConfig.unsavedPaths.length > 0)
const canWrite = computed(() => moonrakerAvailability.value.isAvailable && !machineFiles.isMutating)
const canSave = computed(() => canWrite.value && hasUnsaved.value && !quickConfig.requiresRestart)
const canSaveRestart = computed(
  () =>
    canWrite.value &&
    hasUnsaved.value &&
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint,
)
/*
 * A restart reloads every file, so an edit sitting unsaved in a file Quick
 * config never touched would be left behind in memory while the printer runs
 * without it — the same case the editor's own Save and restart asks about.
 */
const otherUnsavedPaths = computed(() =>
  machineFiles.unsavedFilePaths.filter((path) => !quickConfig.unsavedPaths.includes(path)),
)
const saveTitle = computed(() =>
  quickConfig.requiresRestart ? t('configuration.quickConfig.restartRequired') : undefined,
)
const saveRestartTitle = computed(() =>
  printer.hasActivePrint ? t('configuration.quickConfig.printing') : undefined,
)

function pinOf(field: QuickConfigField) {
  return { section: field.section, option: field.option }
}

function shownText(field: QuickConfigField): string {
  return field.value ?? field.defaultValue ?? ''
}

function numberValue(field: QuickConfigField): number | null {
  const value = Number(shownText(field))
  return shownText(field).trim() !== '' && Number.isFinite(value) ? value : null
}

/*
 * Compared as numbers before writing: rewriting `5.0` as `5` would mark the
 * field unsaved for a change the user never made.
 */
function setNumber(field: QuickConfigField, value: number | null | undefined): void {
  if (value === null || value === undefined || !Number.isFinite(value)) return
  if (numberValue(field) === value) return
  quickConfig.setValue(pinOf(field), String(value))
}

function setText(field: QuickConfigField, value: string | null | undefined): void {
  if (value === null || value === undefined || value === shownText(field)) return
  quickConfig.setValue(pinOf(field), value)
}

function setBoolean(field: QuickConfigField, checked: boolean): void {
  quickConfig.setValue(pinOf(field), checked ? 'True' : 'False')
}

/** Spread rather than bound, since an optional prop may be absent but never `undefined`. */
function unitProps(field: QuickConfigField): { unit?: string } {
  return field.unit ? { unit: t(`configuration.quickConfig.units.${field.unit}`) } : {}
}

function wasLabel(field: QuickConfigField): string {
  return field.savedValue === null
    ? t('configuration.quickConfig.originalDefault')
    : t('configuration.quickConfig.originalValue', { value: field.savedValue })
}

function isBoolean(field: QuickConfigField): boolean {
  return field.kind === 'boolean'
}

function checked(field: QuickConfigField): boolean {
  return shownText(field).toLowerCase() === 'true'
}

function fieldError(field: QuickConfigField) {
  return quickConfig.fieldError(pinOf(field))
}

function pathLabel(location: { path: string; line: number }): string {
  return t('configuration.quickConfig.openLocation', {
    path: location.path,
    line: location.line + 1,
  })
}

function changeLabel(change: UnappliedChange): string {
  if (change.multiline) return t('configuration.quickConfig.unappliedMultiline')
  if (change.disk === null) {
    return t('configuration.quickConfig.unappliedRemoved', { loaded: change.loaded ?? '' })
  }
  if (change.loaded === null) {
    return t('configuration.quickConfig.unappliedAdded', { disk: change.disk })
  }
  return t('configuration.quickConfig.unappliedChanged', {
    loaded: change.loaded,
    disk: change.disk,
  })
}

function locationLabel(field: QuickConfigField): string {
  if (!field.location) return ''
  const values = { path: field.location.path, line: field.location.line + 1 }
  return field.autosave
    ? t('configuration.quickConfig.openLocationAutosave', values)
    : t('configuration.quickConfig.openLocation', values)
}

function lockLabel(field: QuickConfigField): string {
  if (field.lock === 'pendingCalibration') return t('configuration.quickConfig.lockPending')
  if (field.lock === 'multiline') return t('configuration.quickConfig.lockMultiline')
  if (field.lock === 'unknownOption') return t('configuration.quickConfig.lockUnknown')
  return ''
}

function hasStatus(field: QuickConfigField): boolean {
  return (
    fieldError(field) !== null ||
    field.unsaved ||
    field.unapplied ||
    field.lock !== null ||
    !field.location
  )
}

function openLocation(field: QuickConfigField): void {
  if (field.location) emit('openLocation', field.location.path, field.location.line)
}

async function save(restart: boolean): Promise<void> {
  if (restart && otherUnsavedPaths.value.length > 0) {
    if (confirmations.shouldConfirm('saveAllAndRestart')) {
      pendingSaveAllAndRestart.value = true
      return
    }
    if (await machineFiles.saveConfigFiles(machineFiles.unsavedFilePaths, true)) {
      quickConfig.discard()
    }
    return
  }
  await quickConfig.save(restart)
}

async function confirmSaveAllAndRestart(): Promise<void> {
  pendingSaveAllAndRestart.value = false
  if (await machineFiles.saveConfigFiles(machineFiles.unsavedFilePaths, true)) {
    quickConfig.discard()
  }
}

function openPicker(section: string | null): void {
  pickerSection.value = section
  pickerOpen.value = true
}

function saveCard(section: string, options: string[]): void {
  pickerOpen.value = false
  quickConfig.setSectionPins(section, options)
}

const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)

/*
 * As many card-width columns as fit. Measured, not left to CSS, because a card
 * keeps the column it was put in: the count has to be a number the arrangement
 * can be laid out against. The probe is one card wide with the grid's gap as
 * its own `column-gap`, so both come back in pixels from the stylesheet's one
 * definition rather than a second copy of it here.
 */
const columnCount = ref(1)

function measureColumns(): void {
  const container = scroller.value
  const sample = probe.value
  if (!container || !sample || sample.offsetWidth <= 0) return
  const box = getComputedStyle(container)
  const width =
    container.clientWidth -
    (Number.parseFloat(box.paddingLeft) || 0) -
    (Number.parseFloat(box.paddingRight) || 0)
  if (width <= 0) return
  const gap = Number.parseFloat(getComputedStyle(sample).columnGap) || 0
  columnCount.value = Math.max(1, Math.floor((width + gap) / (sample.offsetWidth + gap)))
}

let columnResize: ResizeObserver | null = null

const cardsByKey = computed(() => new Map(quickConfig.cards.map((card) => [card.key, card])))
const committedColumns = computed(() => quickConfig.columnsFor(columnCount.value))

/*
 * Found in the document rather than held as template refs: the columns are
 * TransitionGroups, whose ref is a component instance, not the element.
 */
function columnElements(): (HTMLElement | null | undefined)[] {
  return Array.from({ length: columnCount.value }, (_, index) =>
    root.value?.querySelector<HTMLElement>(`[data-quick-config-column="${index}"]`),
  )
}

/*
 * The dashboard's pointer drag, for the same reason the dashboard has it: the
 * cards sit in columns, and a drop has to name a slot in one — "under this
 * card" — rather than a card to land on. It also previews the result: the card
 * is rendered in the slot it would land in while only the cards below that
 * slot, and below the one it left, move aside.
 */
const drag = useDashboardCardDrag({
  columns: columnElements,
  scroller: () => scroller.value,
  origin: (key) => slotOf(committedColumns.value, key) ?? { column: 0, index: 0 },
  commit: (key, target) =>
    quickConfig.setColumns(moveQuickConfigCard(committedColumns.value, key, target)),
})

const displayedColumns = computed(() => {
  const dragged = drag.instanceId.value
  const slot = drag.target.value
  const columns =
    dragged && slot
      ? moveQuickConfigCard(committedColumns.value, dragged, slot)
      : committedColumns.value
  return columns.map((keys) =>
    keys.flatMap((key) => {
      const card = cardsByKey.value.get(key)
      return card ? [card] : []
    }),
  )
})

/** Off for the whole drag and one tick past it — see DashboardView's `columnsAnimated`. */
const columnsAnimated = ref(true)
watch(
  () => drag.instanceId.value,
  async (dragging) => {
    if (dragging !== null) {
      columnsAnimated.value = false
      return
    }
    await nextTick()
    columnsAnimated.value = true
  },
)

const draggedGhost = computed(() => {
  const position = drag.ghost.value
  const card = drag.instanceId.value ? cardsByKey.value.get(drag.instanceId.value) : undefined
  if (!position || !card) return null
  // A ghost narrower than a hand is not recognisable as the card it came from.
  return { ...position, width: Math.max(position.width, 180), title: `[${card.section}]` }
})

function moveWithinColumn(key: string, direction: -1 | 1): void {
  const slot = slotOf(committedColumns.value, key)
  if (!slot) return
  quickConfig.setColumns(
    moveQuickConfigCard(committedColumns.value, key, {
      column: slot.column,
      index: slot.index + direction,
    }),
  )
}

/** Keeps the card's position in the column where the neighbour has room for it. */
function moveToColumn(key: string, direction: -1 | 1): void {
  const slot = slotOf(committedColumns.value, key)
  const column = slot ? slot.column + direction : -1
  if (!slot || column < 0 || column >= committedColumns.value.length) return
  quickConfig.setColumns(
    moveQuickConfigCard(committedColumns.value, key, { column, index: slot.index }),
  )
}

function requestDiscard(): void {
  if (confirmations.shouldConfirm('discardAllFiles')) pendingDiscard.value = true
  else quickConfig.discard()
}

function confirmDiscard(): void {
  pendingDiscard.value = false
  quickConfig.discard()
}

/*
 * The editor's "Show in Quick config" switches to this view and asks for one
 * field, which may not be rendered until the files it reads have loaded — so
 * the request waits for the field rather than being answered once on mount.
 */
watch(
  () => [quickConfig.revealRequest, quickConfig.cards] as const,
  async ([request]) => {
    if (!request) return
    await nextTick()
    const field = root.value?.querySelector<HTMLElement>(
      `[data-quick-config-field="${CSS.escape(`${request.section}/${request.option}`)}"]`,
    )
    if (!field) return
    quickConfig.revealRequest = null
    field.scrollIntoView({ block: 'center' })
    field.querySelector<HTMLElement>('input, button, select')?.focus({ preventScroll: true })
  },
  { immediate: true, flush: 'post' },
)

onMounted(() => {
  quickConfig.start()
  measureColumns()
  if (typeof ResizeObserver === 'undefined') return
  columnResize = new ResizeObserver(measureColumns)
  if (scroller.value) columnResize.observe(scroller.value)
  if (probe.value) columnResize.observe(probe.value)
})
onBeforeUnmount(() => {
  columnResize?.disconnect()
  quickConfig.stop()
})
</script>

<template>
  <div
    ref="root"
    class="quick-config"
    :data-pending="quickConfig.isLoading || machineFiles.isMutating"
  >
    <div class="quick-config__toolbar">
      <p v-if="quickConfig.unsavedCount > 0" class="quick-config__count">
        {{ t('configuration.quickConfig.unsavedCount', { count: quickConfig.unsavedCount }) }}
      </p>
      <p v-else-if="quickConfig.loadFailed" class="quick-config__notice">
        {{ t('configuration.quickConfig.loadFailed') }}
      </p>
      <div class="quick-config__actions">
        <AppButton
          icon="add"
          :label="t('configuration.quickConfig.addOption')"
          :disabled="!quickConfig.hasLoaded"
          @click="openPicker(null)"
        />
        <AppButton
          variant="primary"
          icon="save"
          :label="t('configuration.quickConfig.save')"
          :title="saveTitle"
          :disabled="!canSave"
          :pending="machineFiles.isMutating"
          @click="save(false)"
        />
        <AppButton
          icon="saveRestart"
          :label="t('configuration.quickConfig.saveRestart')"
          :title="saveRestartTitle"
          :disabled="!canSaveRestart"
          @click="save(true)"
        />
        <AppButton
          variant="danger-quiet"
          icon="undo"
          :label="t('configuration.quickConfig.discard')"
          :disabled="!hasUnsaved"
          @click="requestDiscard"
        />
      </div>
    </div>

    <div ref="scroller" class="quick-config__scroll">
      <div ref="probe" class="quick-config__probe" aria-hidden="true"></div>

      <p v-if="quickConfig.hasLoaded && quickConfig.cards.length === 0" class="quick-config__empty">
        {{ t('configuration.quickConfig.empty') }}
      </p>

      <!--
        A row of their own above the columns rather than cards among them: they
        come and go with Klipper's state, and appearing inside an arrangement
        would push the user's own cards down whenever they did.
      -->
      <div
        v-if="
          quickConfig.hasLoaded &&
          (quickConfig.unapplied.length > 0 || printer.configWarnings.length > 0)
        "
        class="quick-config__notices"
      >
        <!--
          Across the whole configuration, not only pinned options: an edit
          nobody restarted for usually sits in a file nobody has open.
        -->
        <section
          v-if="quickConfig.unapplied.length > 0"
          class="quick-config-card quick-config-card--notice"
          :aria-label="t('configuration.quickConfig.unappliedTitle')"
        >
          <header class="quick-config-card__header">
            <h2 class="quick-config-card__title quick-config-card__title--plain">
              {{ t('configuration.quickConfig.unappliedTitle') }}
            </h2>
          </header>
          <ul class="quick-config-notice__list">
            <li
              v-for="change in quickConfig.unapplied"
              :key="`${change.section}
${change.option}`"
              class="quick-config-notice__row"
            >
              <span class="quick-config-notice__text">
                <span class="quick-config-notice__name"
                  >[{{ change.section }}] {{ change.option }}</span
                >
                <span class="quick-config-notice__detail">{{ changeLabel(change) }}</span>
              </span>
              <AppButton
                v-if="change.location"
                variant="quiet"
                size="xs"
                icon-only
                icon="popout"
                :aria-label="pathLabel(change.location)"
                :title="pathLabel(change.location)"
                @click="emit('openLocation', change.location.path, change.location.line)"
              />
            </li>
          </ul>
        </section>

        <section
          v-if="printer.configWarnings.length > 0"
          class="quick-config-card quick-config-card--notice"
          :aria-label="t('configuration.quickConfig.warningsTitle')"
        >
          <header class="quick-config-card__header">
            <h2 class="quick-config-card__title quick-config-card__title--plain">
              {{ t('configuration.quickConfig.warningsTitle') }}
            </h2>
          </header>
          <ul class="quick-config-notice__list">
            <li
              v-for="(warning, index) in printer.configWarnings"
              :key="index"
              class="quick-config-notice__row"
            >
              <span class="quick-config-notice__text">
                <span v-if="warning.section" class="quick-config-notice__name"
                  >[{{ warning.section }}] {{ warning.option ?? '' }}</span
                >
                <span class="quick-config-notice__detail quick-config-notice__detail--warning">{{
                  warning.message
                }}</span>
              </span>
            </li>
          </ul>
        </section>
      </div>

      <div
        v-if="quickConfig.hasLoaded"
        class="quick-config__columns"
        :data-dragging="drag.instanceId.value ? true : undefined"
        :style="{ '--quick-config-column-count': columnCount }"
      >
        <!--
          One TransitionGroup per column with `css` switched off during a drag,
          exactly as the dashboard's columns do and for the reason recorded
          there: a card previewed into another column has to leave one group
          and enter the other instantly, while `-move` still slides the cards
          that make room for it.
        -->
        <TransitionGroup
          v-for="(column, columnIndex) in displayedColumns"
          :key="columnIndex"
          name="dashboard-grid"
          tag="div"
          class="quick-config__column"
          :css="columnsAnimated"
          :data-quick-config-column="columnIndex"
        >
          <section
            v-for="(card, index) in column"
            :key="card.key"
            class="quick-config-card"
            :class="{ 'quick-config-card--missing': card.missing }"
            :aria-label="card.section"
            :data-instance-id="card.key"
            :data-dragging="drag.instanceId.value === card.key || undefined"
          >
            <header class="quick-config-card__header">
              <h2 class="quick-config-card__title" :title="`[${card.section}]`">
                [{{ card.section }}]
              </h2>
              <!--
                Only the grip starts a drag: a card is full of fields and
                buttons, and a press on any of them has to stay a press.
                Pointer-only and not focusable, like the dashboard's handle —
                the move buttons are the keyboard path.
              -->
              <span
                class="quick-config-card__grip"
                aria-hidden="true"
                @pointerdown="drag.begin($event, card.key)"
              >
                <AppIcon name="drag" class="size-4" />
              </span>
              <div class="quick-config-card__actions">
                <!--
                  Quiet at rest, like Macros' reorder pair: the keyboard and
                  touch path for a move a mouse makes with the grip.
                -->
                <div class="quick-config-card__reorder">
                  <AppButton
                    variant="quiet"
                    size="xs"
                    icon-only
                    icon="up"
                    :disabled="index === 0"
                    :aria-label="
                      t('configuration.quickConfig.moveEarlier', { section: card.section })
                    "
                    :title="t('configuration.quickConfig.moveEarlier', { section: card.section })"
                    @click="moveWithinColumn(card.key, -1)"
                  />
                  <AppButton
                    variant="quiet"
                    size="xs"
                    icon-only
                    icon="down"
                    :disabled="index === column.length - 1"
                    :aria-label="
                      t('configuration.quickConfig.moveLater', { section: card.section })
                    "
                    :title="t('configuration.quickConfig.moveLater', { section: card.section })"
                    @click="moveWithinColumn(card.key, 1)"
                  />
                  <!-- Both would be disabled with one column, and a phone's header has no room for them. -->
                  <template v-if="displayedColumns.length > 1">
                    <AppButton
                      variant="quiet"
                      size="xs"
                      icon-only
                      icon="left"
                      :disabled="columnIndex === 0"
                      :aria-label="
                        t('configuration.quickConfig.moveToPreviousColumn', {
                          section: card.section,
                        })
                      "
                      :title="
                        t('configuration.quickConfig.moveToPreviousColumn', {
                          section: card.section,
                        })
                      "
                      @click="moveToColumn(card.key, -1)"
                    />
                    <AppButton
                      variant="quiet"
                      size="xs"
                      icon-only
                      icon="right"
                      :disabled="columnIndex === displayedColumns.length - 1"
                      :aria-label="
                        t('configuration.quickConfig.moveToNextColumn', { section: card.section })
                      "
                      :title="
                        t('configuration.quickConfig.moveToNextColumn', { section: card.section })
                      "
                      @click="moveToColumn(card.key, 1)"
                    />
                  </template>
                </div>
                <AppButton
                  v-if="!card.missing"
                  variant="quiet"
                  size="xs"
                  icon-only
                  icon="edit"
                  :aria-label="t('configuration.quickConfig.editCard', { section: card.section })"
                  :title="t('configuration.quickConfig.editCard', { section: card.section })"
                  @click="openPicker(card.key)"
                />
              </div>
            </header>

            <ul
              v-if="quickConfig.warningsFor(card.key).length > 0"
              class="quick-config-card__warnings"
            >
              <li v-for="(warning, index) in quickConfig.warningsFor(card.key)" :key="index">
                {{ warning.message }}
              </li>
            </ul>

            <template v-if="card.missing">
              <p class="quick-config-card__missing">
                {{ t('configuration.quickConfig.missingSection') }}
              </p>
              <AppButton
                size="sm"
                :label="t('configuration.quickConfig.unpinSection')"
                @click="quickConfig.unpinSection(card.key)"
              />
            </template>

            <div v-else class="quick-config-card__fields">
              <div
                v-for="field in card.fields"
                :key="field.option"
                class="quick-config-field"
                :data-quick-config-field="`${field.section}/${field.option}`"
              >
                <div class="quick-config-field__row">
                  <label v-if="isBoolean(field)" class="check-row quick-config-field__control">
                    <input
                      type="checkbox"
                      :checked="checked(field)"
                      :disabled="field.lock !== null || !moonrakerAvailability.isAvailable"
                      @change="setBoolean(field, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="quick-config-field__name">{{ field.option }}</span>
                  </label>
                  <AppField
                    v-else-if="field.kind === 'number'"
                    class="quick-config-field__control"
                    :label="field.option"
                    type="number"
                    v-bind="unitProps(field)"
                    :model-value="numberValue(field)"
                    :readonly="field.lock !== null"
                    :disabled="!moonrakerAvailability.isAvailable"
                    @update:model-value="setNumber(field, $event)"
                  />
                  <AppField
                    v-else
                    class="quick-config-field__control"
                    :label="field.option"
                    type="text"
                    v-bind="unitProps(field)"
                    :model-value="shownText(field)"
                    :readonly="field.lock !== null"
                    :disabled="!moonrakerAvailability.isAvailable"
                    @update:model-value="setText(field, $event)"
                  />
                  <AppButton
                    v-if="field.location"
                    variant="quiet"
                    size="xs"
                    icon-only
                    icon="popout"
                    :aria-label="locationLabel(field)"
                    :title="locationLabel(field)"
                    @click="openLocation(field)"
                  />
                </div>

                <!--
                Only when the field has something to say. A resting field is
                one line; where it lives is behind the popout, and whether it
                is Klipper's own SAVE_CONFIG line is in that button's name.
              -->
                <p v-if="hasStatus(field)" class="quick-config-field__status">
                  <span v-if="fieldError(field)" class="quick-config-field__error">{{
                    t('configuration.quickConfig.invalidValue')
                  }}</span>
                  <span v-if="field.unsaved" class="quick-config-field__was"
                    >{{ wasLabel(field) }}
                    <AppButton
                      variant="quiet"
                      size="xs"
                      icon-only
                      icon="reset"
                      :aria-label="t('configuration.quickConfig.revert', { option: field.option })"
                      :title="t('configuration.quickConfig.revert', { option: field.option })"
                      @click="quickConfig.revert(field)"
                  /></span>
                  <span v-else-if="field.unapplied" class="quick-config-field__unapplied">{{
                    t('configuration.quickConfig.unapplied')
                  }}</span>
                  <span v-if="field.lock">{{ lockLabel(field) }}</span>
                  <span v-else-if="!field.location && !field.unsaved">{{
                    t('configuration.quickConfig.default')
                  }}</span>
                </p>
              </div>
            </div>
          </section>
        </TransitionGroup>
      </div>
    </div>

    <!-- The header alone, like the dashboard's ghost, so it does not hide the columns it passes over. -->
    <div
      v-if="draggedGhost"
      class="quick-config-drag-ghost"
      :style="{
        width: `${draggedGhost.width}px`,
        transform: `translate3d(${draggedGhost.x}px, ${draggedGhost.y}px, 0)`,
      }"
      aria-hidden="true"
    >
      <AppIcon name="drag" class="size-4 shrink-0" />
      <span class="truncate">{{ draggedGhost.title }}</span>
    </div>

    <QuickConfigOptionDialog
      :open="pickerOpen"
      :catalogue="quickConfig.catalogue"
      :pins="quickConfig.pins"
      :initial-section="pickerSection"
      @save="saveCard"
      @cancel="pickerOpen = false"
    />

    <ConfirmDialog
      :open="pendingDiscard"
      :title="t('configuration.quickConfig.discardTitle')"
      :description="t('configuration.quickConfig.discardDescription')"
      :items="quickConfig.unsavedPaths"
      :confirm-label="t('configuration.quickConfig.discardConfirm')"
      tone="danger"
      show-skip-option
      @confirm="confirmDiscard"
      @cancel="pendingDiscard = false"
      @skip="confirmations.setSkip('discardAllFiles', true)"
    />

    <ConfirmDialog
      :open="pendingSaveAllAndRestart"
      :title="t('configuration.editor.saveAllRestartTitle')"
      :description="t('configuration.editor.saveAllRestartDescription')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.editor.saveRestartConfirm')"
      show-skip-option
      @confirm="confirmSaveAllAndRestart"
      @cancel="pendingSaveAllAndRestart = false"
      @skip="confirmations.setSkip('saveAllAndRestart', true)"
    />
  </div>
</template>

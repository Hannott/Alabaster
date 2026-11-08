<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'
import FilamentCatalogueDialog from '@/components/FilamentCatalogueDialog.vue'
import AppIcon from '@/components/AppIcon.vue'
import HeaterCalibrationPanel from '@/components/calibration/HeaterCalibrationPanel.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import TemperaturesChartSettingsFields from '@/components/dashboard/modules/TemperaturesChartSettingsFields.vue'
import {
  sensorColorKey,
  sensorColorTokens,
  sensorColorVariable,
  sensorCustomColor,
  sensorLabel,
} from '@/components/dashboard/modules/temperatureSensors'
import {
  configBoolean,
  configOptionalStringList,
  configStringMap,
  useDashboardModule,
} from '@/dashboard/context'
import {
  presetFromDraft,
  readPresetDrafts,
  type TemperaturePresetDraft,
} from '@/dashboard/temperaturePresets'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore, type SensorReading } from '@/stores/telemetry'

/**
 * Temperatures' full configuration: the chart's shape, and heater calibration.
 *
 * Both are here for the same reason. A chart height is a judgement about the
 * card, so it wants the card in view; a calibration is a multi-minute physical
 * procedure with a transcript, which never belonged in a panel that covers the
 * temperatures it is heating. The chart's own settings live in
 * `TemperaturesChartSettingsFields`, shared with the card's quick layer.
 *
 * The calibration is no longer only reachable from here. Its rows, guard and
 * transcript are `HeaterCalibrationPanel`, which the Calibration page's heaters
 * stage renders too — behind a card gear is a defensible home for a rare
 * procedure, but it is not a findable one for somebody who opened Calibration
 * to calibrate a printer.
 */

const { t } = useI18n({ useScope: 'global' })
const telemetry = useTelemetryStore()
const printerConfig = usePrinterConfigStore()
const serverCapabilities = useServerCapabilitiesStore()
const spool = useSpoolStore()
const { config, updateConfig } = useDashboardModule('temperatures')

const skipCalibrationWarning = computed(() =>
  configBoolean(config.value, 'skipCalibrationWarning', false),
)

const chartSeries = computed(() => {
  const configured = configOptionalStringList(config.value, 'chartSeries')
  if (configured === null) {
    return telemetry.sensors.filter((sensor) => sensor.isSettable)
  }
  return telemetry.sensors.filter((sensor) => configured.includes(sensor.objectName))
})

/**
 * Whether the section has anything to offer. The rows themselves are the
 * panel's business; this only decides whether the section exists, which is a
 * question about this pane's own layout.
 */
const hasCalibratableHeater = computed(() =>
  telemetry.sensors.some(
    (sensor) =>
      sensor.isSettable &&
      ['pid', 'mpc'].includes(printerConfig.controlKindFor(sensor.objectName) ?? ''),
  ),
)

function label(sensor: SensorReading): string {
  return sensorLabel(sensor, t)
}

/**
 * What a heater is configured to reach, for the calibration prompt's validation
 * and for the ceiling on each preset column. `max` on a number input bounds a
 * stepper press and not a typed value, so on the preset rows this is a guide
 * and not the guard — `applyPreset` clamps what is actually sent, the same way
 * `commitTarget` clamps a typed target.
 */
function limitFor(objectName: string): number {
  return Math.round(printerConfig.limitsFor(objectName).maximum)
}

/**
 * A row identity that survives a reorder. Keyed by index, a moved row's inputs
 * and buttons stayed where they were and only their contents swapped, so focus
 * stayed on the move button at the old position — a second press of "earlier"
 * moved the preset that had just been displaced, back down.
 */
type PresetRow = TemperaturePresetDraft & { key: number }

let nextPresetKey = 0

function keyed(draft: TemperaturePresetDraft): PresetRow {
  return { ...draft, key: nextPresetKey++ }
}

/**
 * The rows being edited, held here rather than read back out of the card's
 * configuration on every render.
 *
 * Vue re-applies a `:value` binding on every render whether or not the bound
 * value changed, and this pane re-renders several times a second because it
 * lists sensors a live printer keeps updating. Rendering a field from the value
 * it commits on `change` therefore reset it mid-word: typing the second
 * character of a new temperature was impossible against a connected machine,
 * and possible against every fixture. The surface mounts this pane fresh each
 * time it opens, so seeding once is the whole of the synchronisation needed.
 */
const presetDrafts = ref<PresetRow[]>(readPresetDrafts(config.value).map(keyed))
const presetList = ref<HTMLElement | null>(null)

/**
 * Edits write the whole list back, because the stored value may still be the
 * defaults — the first edit has to make them real rather than patching a list
 * that was never written down.
 */
function commitPresets(): void {
  updateConfig({ presets: presetDrafts.value.map(presetFromDraft) })
}

function removePreset(index: number): void {
  presetDrafts.value = presetDrafts.value.filter((_, at) => at !== index)
  commitPresets()
}

function reorderPreset(from: number, to: number): void {
  if (from === to || to < 0 || to >= presetDrafts.value.length) return
  const next = [...presetDrafts.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(to, 0, moved)
  presetDrafts.value = next
  commitPresets()
}

/**
 * Moving a keyed row moves its DOM node, which drops focus from the button
 * that was pressed. Put it back on the same button in the row's new place, or
 * on the other one once the row reaches an end and this one disables.
 */
async function movePreset(index: number, direction: -1 | 1): Promise<void> {
  const key = presetDrafts.value[index]?.key
  reorderPreset(index, index + direction)
  await nextTick()
  const buttons = presetList.value?.querySelectorAll<HTMLButtonElement>(
    `[data-preset-key="${key}"] .preset-row__reorder button`,
  )
  const pressed = buttons?.[direction === -1 ? 0 : 1]
  const other = buttons?.[direction === -1 ? 1 : 0]
  ;(pressed && !pressed.disabled ? pressed : other)?.focus()
}

/**
 * Native HTML5 drag, as in Macros' settings pane, and for the same reason the
 * DOM stays put until `drop`: reordering the keyed rows under a live native
 * drag session cancels it. Only the hovered row is tracked meanwhile.
 */
const draggingPreset = ref<number | null>(null)
const presetDropTarget = ref<number | null>(null)

function onPresetDragStart(key: number, event: DragEvent): void {
  draggingPreset.value = key
  presetDropTarget.value = null
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', '')
  event.dataTransfer.effectAllowed = 'move'
  // The grip is the drag source, but what is being moved is the whole row.
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.preset-row')
  if (row) event.dataTransfer.setDragImage(row, 8, row.offsetHeight / 2)
}

function onPresetDragOver(key: number, event: DragEvent): void {
  if (draggingPreset.value === null || draggingPreset.value === key) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  presetDropTarget.value = key
}

function onPresetDrop(event: DragEvent): void {
  event.preventDefault()
  const keys = presetDrafts.value.map((row) => row.key)
  const from = draggingPreset.value === null ? -1 : keys.indexOf(draggingPreset.value)
  const to = presetDropTarget.value === null ? -1 : keys.indexOf(presetDropTarget.value)
  if (from >= 0 && to >= 0) reorderPreset(from, to)
  onPresetDragEnd()
}

function onPresetDragEnd(): void {
  draggingPreset.value = null
  presetDropTarget.value = null
}

/**
 * An unnamed row is not yet a button on the card, so without the caret landing
 * in it the new row is easy to miss and either entry point reads as having
 * done nothing. Shared by both `addPreset` and the catalogue picker so they
 * cannot drift on it.
 */
async function focusNewPresetRow(): Promise<void> {
  await nextTick()
  const rows = presetList.value?.querySelectorAll<HTMLElement>('.preset-row')
  rows?.[rows.length - 1]?.querySelector('input')?.focus()
}

async function addPreset(): Promise<void> {
  presetDrafts.value = [...presetDrafts.value, keyed({ name: '', extruder: '200', bed: '60' })]
  commitPresets()
  await focusNewPresetRow()
}

const catalogueDialogOpen = ref(false)

/**
 * Visible only where a search could actually answer — the same
 * optimistic-until-proven-otherwise gate `spool.ts` already applies to its own
 * polling, so the button does not wink out the moment Spoolman drops for a
 * beat.
 */
const showCatalogueButton = computed(
  () => serverCapabilities.hasComponent('spoolman') && spool.spoolmanConnected !== false,
)

async function addPresetFromCatalogue(filament: {
  name: string
  extruder: number | null
  bed: number | null
}): Promise<void> {
  catalogueDialogOpen.value = false
  presetDrafts.value = [
    ...presetDrafts.value,
    keyed({
      name: filament.name,
      extruder: filament.extruder === null ? '' : String(filament.extruder),
      bed: filament.bed === null ? '' : String(filament.bed),
    }),
  ]
  commitPresets()
  await focusNewPresetRow()
}

function presetLabel(draft: TemperaturePresetDraft): string {
  return draft.name.trim() === '' ? t('dashboard.temperature.presetUnnamed') : draft.name
}

function isListed(objectName: string): boolean {
  const configured = configOptionalStringList(config.value, 'listSensors')
  return configured === null || configured.includes(objectName)
}

/**
 * A never-customized instance means "all of them", so the first thing
 * unticked has to write the rest out explicitly — otherwise turning one
 * sensor off would read as turning every sensor on. Once written, the list is
 * explicit from then on: unticking the last one has to leave it empty rather
 * than reverting to "all", or removing every sensor would just put them all
 * back. See `configOptionalStringList`.
 */
function toggleListed(objectName: string): void {
  const configured = configOptionalStringList(config.value, 'listSensors')
  const current = configured ?? telemetry.sensors.map((sensor) => sensor.objectName)
  const next = current.includes(objectName)
    ? current.filter((entry) => entry !== objectName)
    : [...current, objectName]
  updateConfig({ listSensors: next })
}

function colorKeyFor(objectName: string): string | null {
  return sensorColorKey(objectName, configStringMap(config.value, 'sensorColors'))
}

function chooseColor(objectName: string, key: string): void {
  updateConfig({
    sensorColors: { ...configStringMap(config.value, 'sensorColors'), [objectName]: key },
  })
}

function customColorFor(objectName: string): string | null {
  return sensorCustomColor(objectName, configStringMap(config.value, 'sensorColors'))
}

/**
 * The eighth swatch's own face when nothing custom has been chosen yet:
 * every token in a ring rather than any one hue, since none of the seven is
 * "the" custom color. Built from the same tokens the fixed swatches use, so
 * it never reaches for a literal outside `src/themes` even for a decoration.
 */
const customColorWheelPreview =
  'conic-gradient(from 0deg, var(--color-data-red), var(--color-data-orange), ' +
  'var(--color-data-yellow), var(--color-data-green), var(--color-data-sky), ' +
  'var(--color-data-blue), var(--color-data-purple), var(--color-data-red))'

function customColorSwatch(objectName: string): string {
  return customColorFor(objectName) ?? customColorWheelPreview
}

/**
 * The sensor `ColorPickerDialog` is open for, or `null` when it is closed —
 * one dialog shared by every row rather than one per sensor, the same reason
 * `HeaterCalibrationPanel` is not duplicated per heater. The picker opens on
 * whatever the sensor is drawn in right now, custom or token, so a small
 * adjustment starts from the current color rather than from nothing.
 */
const colorPickerTarget = ref<string | null>(null)

function openCustomColorPicker(objectName: string): void {
  colorPickerTarget.value = objectName
}

function confirmCustomColor(hex: string): void {
  if (colorPickerTarget.value) chooseColor(colorPickerTarget.value, hex)
  colorPickerTarget.value = null
}

const colorPickerTitle = computed(() => {
  const objectName = colorPickerTarget.value
  const sensor = telemetry.sensors.find((candidate) => candidate.objectName === objectName)
  return t('dashboard.temperature.colorCustomTitle', { sensor: sensor ? label(sensor) : '' })
})

const colorPickerInitialValue = computed(() =>
  colorPickerTarget.value
    ? sensorColorVariable(colorPickerTarget.value, configStringMap(config.value, 'sensorColors'))
    : '',
)

function toggleSeries(objectName: string): void {
  const configured = configOptionalStringList(config.value, 'chartSeries')
  const current = configured ?? chartSeries.value.map((sensor) => sensor.objectName)
  const next = current.includes(objectName)
    ? current.filter((entry) => entry !== objectName)
    : [...current, objectName]
  updateConfig({ chartSeries: next })
}
</script>

<template>
  <SurfaceSection :title="t('dashboard.temperature.chartTitle')">
    <TemperaturesChartSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection
    v-if="telemetry.sensors.length > 0"
    :title="t('dashboard.temperature.sensorsTitle')"
    divided
  >
    <!--
      One list answering both questions, because they are asked about the same
      thing: a printer reports its MCU and host temperatures beside the ones
      anyone watches, and those want hiding from the card and the chart alike.
    -->
    <div class="sensor-matrix">
      <span aria-hidden="true"></span>
      <span class="sensor-matrix__heading">{{ t('dashboard.temperature.columnList') }}</span>
      <span class="sensor-matrix__heading">{{ t('dashboard.temperature.columnChart') }}</span>
      <span aria-hidden="true"></span>

      <template v-for="sensor in telemetry.sensors" :key="`matrix-${sensor.objectName}`">
        <span class="sensor-matrix__name">{{ label(sensor) }}</span>
        <span class="sensor-matrix__cell">
          <input
            type="checkbox"
            :checked="isListed(sensor.objectName)"
            :aria-label="t('dashboard.temperature.listToggle', { sensor: label(sensor) })"
            @change="toggleListed(sensor.objectName)"
          />
        </span>
        <span class="sensor-matrix__cell">
          <input
            type="checkbox"
            :checked="chartSeries.some((series) => series.objectName === sensor.objectName)"
            :aria-label="t('dashboard.temperature.chartToggle', { sensor: label(sensor) })"
            @change="toggleSeries(sensor.objectName)"
          />
        </span>
        <span class="palette-swatches">
          <button
            v-for="token in sensorColorTokens"
            :key="`${sensor.objectName}-${token.key}`"
            type="button"
            class="palette-swatch"
            :style="{ '--swatch': token.variable }"
            :aria-pressed="colorKeyFor(sensor.objectName) === token.key"
            :title="t(`dashboard.temperature.color.${token.key}`)"
            :aria-label="
              t('dashboard.temperature.colorChoice', {
                sensor: label(sensor),
                color: t(`dashboard.temperature.color.${token.key}`),
              })
            "
            @click="chooseColor(sensor.objectName, token.key)"
          >
            <AppIcon
              v-if="colorKeyFor(sensor.objectName) === token.key"
              name="check"
              class="size-4"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="palette-swatch"
            :style="{ '--swatch': customColorSwatch(sensor.objectName) }"
            :aria-pressed="colorKeyFor(sensor.objectName) === null"
            :title="t('dashboard.temperature.colorCustom')"
            :aria-label="t('dashboard.temperature.colorCustomChoice', { sensor: label(sensor) })"
            @click="openCustomColorPicker(sensor.objectName)"
          >
            <AppIcon
              v-if="colorKeyFor(sensor.objectName) === null"
              name="check"
              class="size-4"
              aria-hidden="true"
            />
          </button>
        </span>
      </template>
    </div>
  </SurfaceSection>

  <ColorPickerDialog
    :open="colorPickerTarget !== null"
    :title="colorPickerTitle"
    :initial-value="colorPickerInitialValue"
    :confirm-label="t('dashboard.temperature.colorCustomApply')"
    @confirm="confirmCustomColor"
    @cancel="colorPickerTarget = null"
  />

  <SurfaceSection
    :title="t('dashboard.temperature.presetsTitle')"
    :hint="t('dashboard.temperature.presetsHint')"
    divided
  >
    <div ref="presetList">
      <div
        v-for="(draft, index) in presetDrafts"
        :key="`preset-${draft.key}`"
        class="preset-row"
        :data-preset-key="draft.key"
        :class="{
          'preset-row--dragging': draggingPreset === draft.key,
          'preset-row--drop-target': draggingPreset !== null && presetDropTarget === draft.key,
        }"
        @dragover="onPresetDragOver(draft.key, $event)"
        @drop="onPresetDrop($event)"
      >
        <span
          class="preset-row__grip"
          draggable="true"
          @dragstart="onPresetDragStart(draft.key, $event)"
          @dragend="onPresetDragEnd"
        >
          <AppIcon name="drag" class="size-4" aria-hidden="true" />
        </span>
        <input
          v-model="draft.name"
          class="field field--sm"
          :aria-label="t('dashboard.temperature.presetName')"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          @change="commitPresets"
        />
        <input
          v-model="draft.extruder"
          class="field field--sm field--value"
          type="number"
          min="0"
          :max="limitFor('extruder')"
          :aria-label="t('dashboard.temperature.presetHotend')"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          @change="commitPresets"
        />
        <input
          v-model="draft.bed"
          class="field field--sm field--value"
          type="number"
          min="0"
          :max="limitFor('heater_bed')"
          :aria-label="t('dashboard.temperature.presetBed')"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          @change="commitPresets"
        />
        <div class="preset-row__reorder">
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="up"
            :disabled="index === 0"
            :title="t('dashboard.temperature.presetMoveEarlier', { preset: presetLabel(draft) })"
            :aria-label="
              t('dashboard.temperature.presetMoveEarlier', { preset: presetLabel(draft) })
            "
            @click="movePreset(index, -1)"
          />
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="down"
            :disabled="index === presetDrafts.length - 1"
            :title="t('dashboard.temperature.presetMoveLater', { preset: presetLabel(draft) })"
            :aria-label="t('dashboard.temperature.presetMoveLater', { preset: presetLabel(draft) })"
            @click="movePreset(index, 1)"
          />
        </div>
        <AppButton
          variant="danger-quiet"
          size="sm"
          icon-only
          icon="trash"
          :aria-label="t('dashboard.temperature.presetRemove', { preset: presetLabel(draft) })"
          :title="t('dashboard.temperature.presetRemove', { preset: presetLabel(draft) })"
          @click="removePreset(index)"
        />
      </div>
    </div>

    <div class="mt-2 flex flex-wrap gap-2">
      <AppButton
        size="sm"
        icon="add"
        :label="t('dashboard.temperature.presetAdd')"
        @click="addPreset"
      />
      <AppButton
        v-if="showCatalogueButton"
        size="sm"
        icon="fileSearch"
        :label="t('dashboard.temperature.presetAddFromCatalogue')"
        @click="catalogueDialogOpen = true"
      />
    </div>
  </SurfaceSection>

  <FilamentCatalogueDialog
    :open="catalogueDialogOpen"
    @select="addPresetFromCatalogue"
    @cancel="catalogueDialogOpen = false"
  />

  <SurfaceSection
    v-if="hasCalibratableHeater"
    :title="t('dashboard.temperature.calibrationTitle')"
    :hint="t('dashboard.temperature.calibrationHint')"
    divided
  >
    <!--
      The rows, the guard ladder and the transcript all live in
      `HeaterCalibrationPanel`, shared with the Calibration page's heaters
      stage. This pane keeps the section around it, because a chart height and
      a heater model are both "Temperatures' full configuration" — but the
      procedure itself is no longer only reachable from behind this card's gear.
    -->
    <HeaterCalibrationPanel
      :skip-warning="skipCalibrationWarning"
      @skip="updateConfig({ skipCalibrationWarning: true })"
    />
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.temperature.confirmationsTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipCalibrationWarning"
          @change="updateConfig({ skipCalibrationWarning: !skipCalibrationWarning })"
        />
        <span>{{ t('dashboard.temperature.skipCalibrationWarning') }}</span>
      </label>
    </div>
  </SurfaceSection>
</template>

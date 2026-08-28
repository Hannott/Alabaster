<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import FilamentCatalogueDialog from '@/components/FilamentCatalogueDialog.vue'
import AppIcon from '@/components/AppIcon.vue'
import HeaterCalibrationPanel from '@/components/calibration/HeaterCalibrationPanel.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import TemperaturesChartSettingsFields from '@/components/dashboard/modules/TemperaturesChartSettingsFields.vue'
import {
  sensorColorKey,
  sensorColorTokens,
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
const presetDrafts = ref<TemperaturePresetDraft[]>(readPresetDrafts(config.value))
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
  presetDrafts.value = [...presetDrafts.value, { name: '', extruder: '200', bed: '60' }]
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
    {
      name: filament.name,
      extruder: filament.extruder === null ? '' : String(filament.extruder),
      bed: filament.bed === null ? '' : String(filament.bed),
    },
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

function colorKeyFor(objectName: string): string {
  return sensorColorKey(objectName, configStringMap(config.value, 'sensorColors'))
}

function chooseColor(objectName: string, key: string): void {
  updateConfig({
    sensorColors: { ...configStringMap(config.value, 'sensorColors'), [objectName]: key },
  })
}

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
        </span>
      </template>
    </div>
  </SurfaceSection>

  <SurfaceSection
    :title="t('dashboard.temperature.presetsTitle')"
    :hint="t('dashboard.temperature.presetsHint')"
    divided
  >
    <div ref="presetList">
      <div v-for="(draft, index) in presetDrafts" :key="`preset-${index}`" class="preset-row">
        <input
          v-model="draft.name"
          class="field field--sm"
          :aria-label="t('dashboard.temperature.presetName')"
          @change="commitPresets"
        />
        <input
          v-model="draft.extruder"
          class="field field--sm field--value"
          type="number"
          min="0"
          :max="limitFor('extruder')"
          :aria-label="t('dashboard.temperature.presetHotend')"
          @change="commitPresets"
        />
        <input
          v-model="draft.bed"
          class="field field--sm field--value"
          type="number"
          min="0"
          :max="limitFor('heater_bed')"
          :aria-label="t('dashboard.temperature.presetBed')"
          @change="commitPresets"
        />
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
    <HeaterCalibrationPanel :skip-warning="skipCalibrationWarning" />
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

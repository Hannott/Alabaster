<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FilamentCatalogueDialog from '@/components/FilamentCatalogueDialog.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import AppIcon from '@/components/AppIcon.vue'
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
import { useActionGuard } from '@/composables/useActionGuard'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'
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
 */

/** A default calibration target for a heater that has never had one set. */
const defaultCalibrationTarget = 200

const { t } = useI18n({ useScope: 'global' })
const telemetry = useTelemetryStore()
const printer = usePrinterStore()
// The calibration transcript is read off the console store's raw lines.
const gcodeConsole = useConsoleStore()
const printerConfig = usePrinterConfigStore()
const serverCapabilities = useServerCapabilitiesStore()
const spool = useSpoolStore()
const { config, updateConfig } = useDashboardModule('temperatures')

// Calibration is a rare, physical action, so its whole flow lives behind one
// "currently calibrating" sensor rather than per-row state.
const calibratingObjectName = ref<string | null>(null)
const calibrationKind = ref<'pid' | 'mpc'>('pid')
const calibrationPromptOpen = ref(false)
const calibrationConfirmOpen = ref(false)
const calibrationTargetDraft = ref(defaultCalibrationTarget)
const calibrationTranscriptStart = ref(0)
const calibrationSucceeded = ref<boolean | null>(null)
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

const calibratableSensors = computed(() =>
  telemetry.sensors.filter(
    (sensor) => sensor.isSettable && calibrationKindFor(sensor.objectName) !== null,
  ),
)
const calibratingSensorLabel = computed(() => {
  const reading = telemetry.readings[calibratingObjectName.value ?? '']
  return reading ? sensorLabel(reading, t) : ''
})
const calibrationTranscript = computed(() =>
  gcodeConsole.consoleLines.slice(calibrationTranscriptStart.value),
)
const showCalibrationPanel = computed(
  () =>
    calibratingObjectName.value !== null &&
    (printer.pendingCommands.calibrateHeater || calibrationSucceeded.value !== null),
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
 * Calibration is refused while a job is loaded, not merely while one is moving.
 * `PID_CALIBRATE` and `MPC_CALIBRATE` drive the heater through their own
 * heat-up cycle for minutes, which ends a paused print as surely as it ruins a
 * running one — and the section's own hint and confirmation both said "do not
 * start this while printing" while the button stayed enabled in exactly that
 * state, which is advice you can only read where it already applies. Same line
 * and same reason as `MovementModule`'s `hasJobLoaded`.
 */
const hasJobLoaded = computed(() => printer.hasActivePrint)

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

/**
 * A `watermark` (bang-bang) heater has no PID/MPC constants to calibrate, so
 * only these two control schemes ever offer the action.
 */
function calibrationKindFor(objectName: string): 'pid' | 'mpc' | null {
  const kind = printerConfig.controlKindFor(objectName)
  return kind === 'pid' || kind === 'mpc' ? kind : null
}

function isCalibrating(objectName: string): boolean {
  return calibratingObjectName.value === objectName && printer.pendingCommands.calibrateHeater
}

function openCalibrationPrompt(sensor: SensorReading): void {
  const kind = calibrationKindFor(sensor.objectName)
  if (!kind) return
  calibratingObjectName.value = sensor.objectName
  calibrationKind.value = kind
  calibrationSucceeded.value = null
  calibrationTargetDraft.value =
    sensor.target !== null && sensor.target > 0
      ? Math.round(sensor.target)
      : defaultCalibrationTarget
  calibrationPromptOpen.value = true
}

function validateCalibrationTarget(value: string): string | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return t('dashboard.temperature.calibrateInvalid')
  }
  const reading = telemetry.readings[calibratingObjectName.value ?? '']
  const max = reading ? limitFor(reading.objectName) : 999
  if (parsed > max) return t('dashboard.temperature.calibrateTooHigh', { max })
  return undefined
}

/*
 * PID and MPC calibration drives the heater through a deliberate overshoot
 * cycle and writes a new model, so it is terminal in the sense the ladder
 * means: it is refused outright while a job is loaded, and with its
 * confirmation switched off there is nothing between one click and a heater
 * cycling on a machine the reader may have walked away from.
 */
const calibrationGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  moduleFlag: skipCalibrationWarning,
})

function confirmCalibrationTarget(value: string): void {
  calibrationTargetDraft.value = Number(value)
  calibrationPromptOpen.value = false
  calibrationGuard.request(
    () => void startCalibration(),
    () => (calibrationConfirmOpen.value = true),
  )
}

async function startCalibration(): Promise<void> {
  calibrationConfirmOpen.value = false
  const objectName = calibratingObjectName.value
  if (!objectName) return
  // Only the lines the calibration itself produces belong in its transcript —
  // never whatever else happened to be in the shared console buffer already.
  calibrationTranscriptStart.value = gcodeConsole.consoleLines.length
  calibrationSucceeded.value = await printer.calibrateHeater(
    calibrationKind.value,
    objectName,
    calibrationTargetDraft.value,
  )
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
        <button
          type="button"
          class="button button--danger-quiet button--sm button--icon"
          :aria-label="t('dashboard.temperature.presetRemove', { preset: presetLabel(draft) })"
          :title="t('dashboard.temperature.presetRemove', { preset: presetLabel(draft) })"
          @click="removePreset(index)"
        >
          <AppIcon name="trash" class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="mt-2 flex flex-wrap gap-2">
      <button type="button" class="button button--sm" @click="addPreset">
        <AppIcon name="add" class="size-4" aria-hidden="true" />
        {{ t('dashboard.temperature.presetAdd') }}
      </button>
      <button
        v-if="showCatalogueButton"
        type="button"
        class="button button--sm"
        @click="catalogueDialogOpen = true"
      >
        <AppIcon name="fileSearch" class="size-4" aria-hidden="true" />
        {{ t('dashboard.temperature.presetAddFromCatalogue') }}
      </button>
    </div>
  </SurfaceSection>

  <FilamentCatalogueDialog
    :open="catalogueDialogOpen"
    @select="addPresetFromCatalogue"
    @cancel="catalogueDialogOpen = false"
  />

  <SurfaceSection
    v-if="calibratableSensors.length > 0"
    :title="t('dashboard.temperature.calibrationTitle')"
    :hint="t('dashboard.temperature.calibrationHint')"
    divided
  >
    <div
      v-for="sensor in calibratableSensors"
      :key="`calibrate-${sensor.objectName}`"
      class="temperature-calibrate-row"
    >
      <span class="min-w-0 truncate">{{ label(sensor) }}</span>
      <button
        type="button"
        class="button button--sm"
        :class="calibrationGuard.variant.value"
        v-bind="calibrationGuard.bind.value"
        :data-pending="isCalibrating(sensor.objectName) ? 'true' : undefined"
        :aria-busy="isCalibrating(sensor.objectName) || undefined"
        :disabled="printer.pendingCommands.calibrateHeater || hasJobLoaded"
        :title="hasJobLoaded ? t('dashboard.temperature.calibrateBlocked') : undefined"
        @click="openCalibrationPrompt(sensor)"
      >
        {{
          calibrationKindFor(sensor.objectName) === 'mpc'
            ? t('dashboard.temperature.calibrateMpc')
            : t('dashboard.temperature.calibratePid')
        }}
      </button>
    </div>

    <div v-if="showCalibrationPanel" class="mt-2">
      <ol
        class="console-output selectable"
        role="log"
        tabindex="0"
        :aria-label="t('dashboard.temperature.calibrationOutputLabel')"
      >
        <li v-if="calibrationTranscript.length === 0" class="text-muted">
          {{ t('dashboard.temperature.calibrationRunning') }}
        </li>
        <li v-for="(line, index) in calibrationTranscript" :key="index">{{ line }}</li>
      </ol>
      <p v-if="calibrationSucceeded === false" class="mt-2 text-alert-inline" role="alert">
        {{ t('dashboard.commandFailed') }}
      </p>
      <!--
        A statement, not an action. The calibration has staged a new heater model
        and nothing has written it yet — but writing the config is one
        printer-wide fact, offered once from the header rather than by whichever
        surface staged it, so this says what happened and names where to make it
        permanent.
      -->
      <p v-if="calibrationSucceeded === true" class="hint mt-2">
        {{ t('dashboard.temperature.calibrationStaged') }}
      </p>
    </div>
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

  <PromptDialog
    :open="calibrationPromptOpen"
    :title="t('dashboard.temperature.calibratePromptTitle', { heater: calibratingSensorLabel })"
    :description="t('dashboard.temperature.calibratePromptDescription')"
    :label="t('dashboard.temperature.calibratePromptLabel')"
    :initial-value="String(calibrationTargetDraft)"
    :confirm-label="t('dashboard.temperature.calibrateConfirmAction')"
    :validate="validateCalibrationTarget"
    @confirm="confirmCalibrationTarget"
    @cancel="calibrationPromptOpen = false"
  />
  <ConfirmDialog
    :open="calibrationConfirmOpen"
    :title="t('dashboard.temperature.calibrateConfirmTitle', { heater: calibratingSensorLabel })"
    :description="
      t('dashboard.temperature.calibrateConfirmDescription', {
        heater: calibratingSensorLabel,
        target: calibrationTargetDraft,
        unit: t('dashboard.temperatureUnit'),
      })
    "
    :confirm-label="t('dashboard.temperature.calibrateConfirmAction')"
    @confirm="startCalibration"
    @cancel="calibrationConfirmOpen = false"
  />
</template>

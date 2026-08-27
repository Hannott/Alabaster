<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import { sensorLabel } from '@/components/dashboard/modules/temperatureSensors'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore, type SensorReading } from '@/stores/telemetry'

/**
 * Running `PID_CALIBRATE` or `MPC_CALIBRATE` on one heater, with the transcript
 * the run answers in.
 *
 * Extracted from `TemperaturesSettingsPane`, which is where this used to be the
 * only way to reach a heater calibration at all: behind the gear of a dashboard
 * card, inside its settings surface. That is a defensible place for it — the
 * pane's own comment says why, and it still renders there — but it is not a
 * findable one for somebody who came to calibrate a printer, which is what sent
 * them to the Dashboard mid-sitting. One component, two hosts; the commands,
 * the guard ladder, and the transcript cannot drift between them.
 *
 * The panel deliberately owns no chrome. Each host wraps it in whatever its own
 * surface is — a `SurfaceSection` in the pane, a `page-card` on Calibration.
 */
const props = defineProps<{
  /**
   * Whether the terminal confirmation is switched off for this user. Passed in
   * rather than read from the Temperatures card's configuration here, because
   * the flag belongs to the card and this component is no longer only the
   * card's. Both hosts pass the same value, so switching it off in the pane
   * switches it off on Calibration too.
   */
  skipWarning?: boolean
}>()

/** A default calibration target for a heater that has never had one set. */
const defaultCalibrationTarget = 200

const { t } = useI18n({ useScope: 'global' })
const telemetry = useTelemetryStore()
const printer = usePrinterStore()
// The calibration transcript is read off the console store's raw lines.
const gcodeConsole = useConsoleStore()
const printerConfig = usePrinterConfigStore()

// Calibration is a rare, physical action, so its whole flow lives behind one
// "currently calibrating" sensor rather than per-row state.
const calibratingObjectName = ref<string | null>(null)
const calibrationKind = ref<'pid' | 'mpc'>('pid')
const calibrationPromptOpen = ref(false)
const calibrationConfirmOpen = ref(false)
const calibrationTargetDraft = ref(defaultCalibrationTarget)
const calibrationTranscriptStart = ref(0)
const calibrationSucceeded = ref<boolean | null>(null)

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

function label(sensor: SensorReading): string {
  return sensorLabel(sensor, t)
}

/**
 * What a heater is configured to reach, for the calibration prompt's
 * validation.
 */
function limitFor(objectName: string): number {
  return Math.round(printerConfig.limitsFor(objectName).maximum)
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
  moduleFlag: computed(() => props.skipWarning === true),
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
  <div>
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
  </div>
</template>

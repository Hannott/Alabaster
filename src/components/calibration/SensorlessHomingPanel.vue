<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useConfigWrite } from '@/composables/useConfigWrite'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  attemptScript,
  narrowRange,
  nextValue,
  recommendedSensitivity,
  sensitivityRange,
  stallDriversFor,
  type Attempt,
  type AttemptOutcome,
} from '@/features/calibration/sensorless'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * Stall sensitivity for sensorless homing, searched the way Klipper's TMC
 * guide describes. Each attempt sets a sensitivity and homes the one axis;
 * what it did — stopped short, stopped at the end with one touch, or banged
 * against it — is something only the reader sees and hears, so they say it,
 * and the panel keeps the list and works out the value from it.
 *
 * Nothing is written until the reader saves: every attempt goes to the
 * running driver with `SET_TMC_FIELD` and is gone at the next restart.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const context = useProcedureContext()
const { availability: klipperAvailability } = useAvailability('klipper')
const configWrite = useConfigWrite()

const drivers = computed(() => stallDriversFor(context.value.sections, context.value.settings))
const chosen = ref<string | null>(null)
const driver = computed(
  () => drivers.value.find((candidate) => candidate.stepper === chosen.value) ?? drivers.value[0],
)

const attempts = ref<Attempt[]>([])
const value = ref<number | null>(null)

watch(
  () => driver.value?.stepper,
  () => {
    attempts.value = []
    value.value = driver.value ? nextValue(driver.value, undefined) : null
    configWrite.forget()
  },
  { immediate: true },
)

const stepperSettings = computed(() =>
  driver.value ? context.value.settings(driver.value.stepper) : null,
)
const driverSettings = computed(() =>
  driver.value ? context.value.settings(driver.value.section) : null,
)
const inFile = computed(() => {
  const saved = driverSettings.value?.[driver.value?.option.toLowerCase() ?? '']
  return typeof saved === 'number' || typeof saved === 'string' ? String(saved) : null
})

/* The two settings the guide says spoil a search before it starts, stated where they are wrong. */
const retract = computed(() => Number(stepperSettings.value?.homing_retract_dist ?? 5))
const holdCurrent = computed(() => driverSettings.value?.hold_current)

const homing = ref(false)
/** The value the last attempt homed with, waiting for the reader's answer. */
const awaiting = ref<number | null>(null)

const canHome = computed(
  () =>
    driver.value !== undefined &&
    value.value !== null &&
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    !homing.value &&
    awaiting.value === null &&
    calibration.activeRun === null &&
    !printer.pendingCommands.calibration,
)

async function home(): Promise<void> {
  if (!driver.value || value.value === null) return
  homing.value = true
  const tried = Math.round(value.value)
  try {
    /*
     * A home that stops short can still return as a success — the driver
     * reported a stall, and Klipper takes that as the endstop — so the
     * reader's answer is asked for either way.
     */
    await printer.sendGcode(attemptScript(driver.value, tried), 'calibration', { timeoutMs: null })
    awaiting.value = tried
  } finally {
    homing.value = false
  }
}

function answer(outcome: AttemptOutcome): void {
  if (!driver.value || awaiting.value === null) return
  const attempt = { value: awaiting.value, outcome }
  attempts.value = [...attempts.value, attempt]
  awaiting.value = null
  value.value = nextValue(driver.value, attempt)
  configWrite.forget()
}

const range = computed(() =>
  driver.value ? sensitivityRange(driver.value, attempts.value) : { maximum: null, minimum: null },
)
const recommended = computed(() => recommendedSensitivity(range.value))
const isNarrow = computed(
  () =>
    range.value.maximum !== null &&
    range.value.minimum !== null &&
    Math.abs(range.value.maximum - range.value.minimum) < narrowRange,
)

async function save(): Promise<void> {
  if (!driver.value || recommended.value === null) return
  const outcome = await configWrite.write('sensitivity', driver.value.section, [
    { option: driver.value.option, value: String(recommended.value) },
  ])
  if (outcome === null || outcome === 'refused') return
  calibration.recordManual(
    'sensorlessHoming',
    {
      stepper: driver.value.stepper,
      maximum: String(range.value.maximum),
      minimum: String(range.value.minimum),
    },
    [
      {
        label: { literal: driver.value.option },
        before: inFile.value,
        after: String(recommended.value),
      },
    ],
    'measured',
  )
}

const saveOutcome = computed(() => configWrite.outcomeFor('sensitivity'))

function historySummary(entry: CalibrationLogEntry): string {
  const row = entry.rows[0]
  const option = row && 'literal' in row.label ? row.label.literal : ''
  return `${entry.values.stepper} · ${option} ${row?.before ?? '—'} → ${row?.after ?? '—'}`
}
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.sensorlessHoming.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">{{ driver?.option }}</span>
      <span>{{ inFile ?? '—' }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.sensorlessHoming.detail') }}
    </p>

    <div class="calibration-params">
      <fieldset v-if="drivers.length > 1" class="calibration-choice">
        <legend class="calibration-choice__legend">{{ t('calibration.param.stepper') }}</legend>
        <label
          v-for="candidate in drivers"
          :key="candidate.stepper"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            name="sensorless-stepper"
            :value="candidate.stepper"
            :checked="driver?.stepper === candidate.stepper"
            :disabled="homing || awaiting !== null"
            @change="chosen = candidate.stepper"
          />
          <span>{{ candidate.stepper }}</span>
        </label>
      </fieldset>
    </div>

    <p v-if="retract !== 0" class="calibration-panel__hint" role="alert">
      {{ t('calibration.sensorless.retract', { stepper: driver?.stepper ?? '', value: retract }) }}
    </p>
    <p v-if="holdCurrent !== undefined" class="calibration-panel__hint" role="alert">
      {{ t('calibration.sensorless.holdCurrent', { section: driver?.section ?? '' }) }}
    </p>

    <ol v-if="driver" class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.sensorless.centre') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            :label="t('calibration.sensorless.motorsOff')"
            :pending="printer.pendingCommands.motorsOff"
            :disabled="!klipperAvailability.isAvailable || printer.hasActivePrint || homing"
            @click="printer.disableMotors()"
          />
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{
          t('calibration.sensorless.attempt', {
            most: driver.mostSensitive,
            least: driver.leastSensitive,
          })
        }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="value"
            size="sm"
            :label="driver.field.toUpperCase()"
            :min="Math.min(driver.mostSensitive, driver.leastSensitive)"
            :max="Math.max(driver.mostSensitive, driver.leastSensitive)"
            :step="1"
          />
          <AppButton
            size="sm"
            icon="home"
            :label="t('calibration.sensorless.home', { axis: driver.axis })"
            :pending="homing"
            :disabled="!canHome"
            @click="home"
          />
        </div>
      </li>
      <li v-if="awaiting !== null" class="calibration-step">
        <span class="calibration-step__text">{{
          t('calibration.sensorless.what', { value: awaiting })
        }}</span>
        <div class="calibration-step__controls">
          <AppButton
            v-for="outcome in ['stoppedEarly', 'singleTouch', 'banged'] as const"
            :key="outcome"
            size="sm"
            :label="t(`calibration.sensorless.outcome.${outcome}`)"
            @click="answer(outcome)"
          />
        </div>
      </li>
    </ol>
    <p class="calibration-panel__hint">{{ t('calibration.sensorless.stop') }}</p>

    <div v-if="attempts.length > 0" class="calibration-result" role="status" aria-live="polite">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ driver?.field.toUpperCase() }}</th>
            <th scope="col">{{ t('calibration.sensorless.result') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(attempt, index) in attempts" :key="index">
            <td class="calibration-result__number">{{ attempt.value }}</td>
            <td>{{ t(`calibration.sensorless.outcome.${attempt.outcome}`) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="calibration-panel__hint">
        {{
          t('calibration.sensorless.range', {
            maximum: range.maximum ?? '—',
            minimum: range.minimum ?? '—',
          })
        }}
      </p>
      <p v-if="isNarrow" class="calibration-panel__hint" role="alert">
        {{ t('calibration.sensorless.narrow', { count: narrowRange }) }}
      </p>
      <div v-if="recommended !== null && driver" class="calibration-result__actions">
        <span class="calibration-workspace__command">{{ driver.option }}: {{ recommended }}</span>
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.npa.saveRestart')"
          :pending="configWrite.writing.value === 'sensitivity'"
          :disabled="configWrite.disabled.value || String(recommended) === inFile"
          @click="save"
        />
        <span v-if="saveOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${saveOutcome}`)
        }}</span>
      </div>
    </div>

    <CalibrationHistory id="sensorlessHoming" :summary="historySummary" />
  </CalibrationCard>
</template>

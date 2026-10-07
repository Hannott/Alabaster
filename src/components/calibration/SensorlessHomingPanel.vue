<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import CalibrationRequirements from '@/components/calibration/CalibrationRequirements.vue'
import { onKlipperRestart } from '@/composables/onKlipperRestart'
import { useAvailability } from '@/composables/useAvailability'
import { useConfigWrite } from '@/composables/useConfigWrite'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { procedureById } from '@/features/calibration/procedures'
import {
  attemptScript,
  narrowRange,
  setupSnippet,
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

const drivers = computed(() =>
  stallDriversFor(context.value.sections, context.value.settings, context.value.written),
)
const chosen = ref<string | null>(null)
const driver = computed(
  () => drivers.value.find((candidate) => candidate.stepper === chosen.value) ?? drivers.value[0],
)

const attempts = ref<Attempt[]>([])
/** Klipper's words for the last attempt that failed, until the next one. */
const failure = ref<string | null>(null)
const value = ref<number | null>(null)

watch(
  () => driver.value?.stepper,
  () => {
    attempts.value = []
    failure.value = null
    value.value = driver.value ? nextValue(driver.value, undefined) : null
    configWrite.forget()
  },
  { immediate: true },
)

/* The file's own line: `configfile.settings` reports a default of 0 for a driver with no line. */
const inFile = computed(() => {
  const written = driver.value ? context.value.written(driver.value.section) : null
  const saved =
    written?.[driver.value?.option.toLowerCase() ?? ''] ?? written?.[driver.value?.option ?? '']
  return typeof saved === 'string' && saved.trim() !== '' ? saved.trim() : null
})

/*
 * Klipper's words for a failed attempt, and the attempt waiting for an
 * answer, are this panel's notes about the printer; a restart ends both.
 * The attempts themselves are what the reader saw, and stay.
 */
onKlipperRestart(() => {
  failure.value = null
  awaiting.value = null
})

/*
 * What the config has to say before the search means anything, as the lines
 * to write: an axis still homing on its switch, a second homing move, a hold
 * current. The DIAG pin is the one value only the wiring knows.
 */
const setup = computed(() => driver.value?.setup ?? null)

/*
 * The DIAG pin is the one value only the wiring knows. It starts as the
 * axis's endstop pin, because a board's DIAG jumper connects the driver to
 * that same input, and the reader corrects it where their wiring differs.
 */
const needsPin = computed(() => setup.value?.lines.some((line) => line.value === null) ?? false)
const diagPin = ref('')
watch(
  () => driver.value?.stepper,
  (stepper) => {
    const pin = stepper ? context.value.settings(stepper)?.endstop_pin : undefined
    diagPin.value = typeof pin === 'string' && !/virtual_endstop/.test(pin) ? pin.trim() : ''
  },
  { immediate: true },
)
/** A pin as Klipper names one: pull-up, inversion and an MCU prefix allowed, nothing else. */
const pinValid = computed(() =>
  /^[\^~!]*[A-Za-z0-9_.-]+(:[A-Za-z0-9_.-]+)?$/.test(diagPin.value.trim()),
)

const snippet = computed(() =>
  setup.value
    ? setupSnippet(
        setup.value,
        pinValid.value ? diagPin.value.trim() : t('calibration.sensorless.setup.pin'),
      )
    : '',
)

/*
 * Every section the setup touches, each written with its own lines and
 * removals, and one restart after the last, so the axis comes back up homing
 * on its driver with the whole setup in place rather than half of it.
 */
async function fixConfig(): Promise<void> {
  const current = setup.value
  if (!current || (needsPin.value && !pinValid.value)) return
  const sections = [
    ...new Set([
      ...current.lines.map((line) => line.section),
      ...current.removes.map((removal) => removal.section),
    ]),
  ]
  for (const [index, section] of sections.entries()) {
    const outcome = await configWrite.write(
      'setup',
      section,
      current.lines
        .filter((line) => line.section === section)
        .map((line) => ({ option: line.option, value: line.value ?? diagPin.value.trim() })),
      current.removes
        .filter((removal) => removal.section === section)
        .map((removal) => removal.option),
      index === sections.length - 1,
    )
    if (outcome === null || outcome === 'refused') return
  }
}

const setupOutcome = computed(() => configWrite.outcomeFor('setup'))

const homing = ref(false)
/** The value the last attempt homed with, waiting for the reader's answer. */
const awaiting = ref<number | null>(null)

const canHome = computed(
  () =>
    driver.value !== undefined &&
    !driver.value.setup.blocking &&
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
    const homed = await printer.sendGcode(attemptScript(driver.value, tried), 'calibration')
    /*
     * A home that ran its whole move without a stall fails, and Klipper says
     * so; that is the answer, so it is recorded rather than asked. Any other
     * failure is shown as Klipper worded it and recorded as nothing.
     */
    if (homed) {
      awaiting.value = tried
      failure.value = null
    } else {
      const message = printer.lastCommandErrorMessage ?? ''
      failure.value = message
      if (/No trigger on \w+ after full movement/i.test(message)) {
        const attempt = { value: tried, outcome: 'noTrigger' as const }
        attempts.value = [...attempts.value, attempt]
        value.value = nextValue(driver.value, attempt)
      }
    }
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

    <CalibrationRequirements :requires="procedureById('sensorlessHoming')!.requires" />

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

    <div
      v-if="driver && setup && (setup.lines.length > 0 || setup.removes.length > 0)"
      class="calibration-sensorless-setup"
    >
      <p class="calibration-panel__hint" role="alert">
        {{
          t(
            !setup.blocking
              ? 'calibration.sensorless.setup.adjust'
              : setup.lines.some((line) => line.option === 'endstop_pin')
                ? 'calibration.sensorless.setup.switch'
                : 'calibration.sensorless.setup.direction',
            { stepper: driver.stepper },
          )
        }}
      </p>
      <pre v-if="snippet" class="calibration-snippet selectable">{{ snippet }}</pre>
      <p
        v-for="removal in setup.removes"
        :key="`${removal.section}.${removal.option}`"
        class="calibration-panel__hint"
      >
        {{ t('calibration.sensorless.setup.remove', removal) }}
      </p>
      <div class="calibration-step__controls">
        <AppField
          v-if="needsPin"
          v-model="diagPin"
          type="text"
          size="sm"
          :label="t('calibration.sensorless.setup.diagPin')"
        />
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.sensorless.setup.fix')"
          :pending="configWrite.writing.value === 'setup'"
          :disabled="configWrite.disabled.value || (needsPin && !pinValid)"
          @click="fixConfig"
        />
      </div>
      <p v-if="needsPin" class="calibration-panel__hint">
        {{ t('calibration.sensorless.setup.pinHint') }}
      </p>
      <p v-if="setupOutcome" class="calibration-panel__hint" role="status">
        {{ t(`calibration.result.persist.${setupOutcome}`) }}
      </p>
      <p v-else-if="setup.blocking" class="calibration-panel__hint">
        {{ t('calibration.sensorless.setup.restart') }}
      </p>
    </div>

    <ol v-if="driver && !driver.setup.blocking" class="calibration-steps">
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
    <p v-if="failure" class="calibration-panel__hint" role="alert">
      {{
        t(
          /No trigger/i.test(failure)
            ? 'calibration.sensorless.noTrigger'
            : 'calibration.sensorless.failed',
          { message: failure },
        )
      }}
    </p>
    <p v-if="driver && !driver.setup.blocking" class="calibration-panel__hint">
      {{ t('calibration.sensorless.stop') }}
    </p>

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

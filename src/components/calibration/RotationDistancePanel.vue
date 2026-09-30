<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import RotationHardwareFields, {
  type RotationProposal,
} from '@/components/calibration/RotationHardwareFields.vue'
import RotationResult from '@/components/calibration/RotationResult.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureText } from '@/composables/useProcedureText'
import { formatNumber, stepperDrive, suggestedFullSteps } from '@/features/calibration/axisRotation'
import { rotationDistanceFrom } from '@/features/calibration/rotationDistance'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore } from '@/stores/telemetry'

/**
 * The extruder's rotation distance, two ways.
 *
 * Measured, the way the Klipper documentation describes: mark the filament a
 * known length above the extruder, extrude less than that, measure what is
 * left, and scale the configured value by how far the filament actually moved.
 * A guided panel rather than a form because the measurement is the reader's,
 * taken with a ruler between two steps the printer does.
 *
 * From the hardware: the drive gear's effective diameter, the gear ratio of a
 * geared extruder, and the motor's step angle. A drive gear bites to a depth
 * the part's own numbers do not state, so this is the starting value a new
 * extruder needs before the first measurement, not a replacement for it.
 *
 * Either result goes to the config lines Klipper uses, through the same
 * locator Quick config writes with — never silently: it is offered, and it
 * takes a firmware restart to apply, which the header's restart already says.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const telemetry = useTelemetryStore()
const { when } = useProcedureText()
const { availability: klipperAvailability } = useAvailability('klipper')

/*
 * Klipper refuses an extrude-only move longer than `max_extrude_only_distance`
 * (50 mm unless configured), so the requested length never exceeds it; the
 * mark sits 20 mm past it so there is always something left to measure.
 */
const requested = ref(Math.min(100, printerConfig.maxExtrudeDistance))
const marked = ref(requested.value + 20)
const remaining = ref<number | null>(null)
const heatTarget = ref(200)

type Method = 'measure' | 'hardware'
const method = ref<Method>('measure')

const configured = computed(() => stepperDrive(printerConfig.section('extruder')))
const current = computed(() => configured.value.rotationDistance)
const hardwareProposal = ref<RotationProposal | null>(null)
const hotend = computed(() => telemetry.hotend)
const hotEnough = computed(
  () => (hotend.value.temperature ?? 0) >= printerConfig.minExtrudeTemperature,
)

const proposed = computed(() =>
  current.value === null || remaining.value === null
    ? null
    : rotationDistanceFrom(current.value, requested.value, marked.value, remaining.value),
)

/*
 * An extruder that fed half or twice what it was asked is a motor configured
 * with the wrong step angle, the same as on an axis — see `suggestedFullSteps`.
 */
const fullStepsHint = computed(() =>
  remaining.value === null
    ? null
    : suggestedFullSteps(
        configured.value.fullSteps,
        requested.value,
        marked.value - remaining.value,
      ),
)

const measuredProposal = computed(() => {
  if (proposed.value === null || current.value === null) return null
  const base = { gearRatio: configured.value.gearRatio, fullSteps: configured.value.fullSteps }
  return fullStepsHint.value === null
    ? { ...base, rotationDistance: Number(formatNumber(proposed.value, 4)) }
    : { ...base, rotationDistance: current.value, fullSteps: fullStepsHint.value }
})

const proposal = computed(() =>
  method.value === 'hardware' ? hardwareProposal.value : measuredProposal.value,
)
const logValues = computed((): Record<string, string> => {
  if (method.value === 'hardware')
    return { method: 'hardware', ...(hardwareProposal.value?.values ?? {}) }
  return {
    method: 'measure',
    requested: String(requested.value),
    marked: String(marked.value),
    remaining: String(remaining.value),
  }
})

const extruding = ref(false)
const extruded = ref(false)

/*
 * A measurement is only true of the rotation distance it was made with. Once
 * a written value is running, the proposal would be worked out again from
 * the new value and the old measurement — correcting it a second time — so
 * the measurement goes, and the next one starts from an extrude.
 */
watch(current, () => {
  remaining.value = null
  extruded.value = false
})

/*
 * Slowly — 1 mm/s — because a fast extrude into free air slips in the
 * extruder gears and measures the slip rather than the steps. The transport's
 * local deadline is off for the same reason the other long commands opt out:
 * this takes as long as the length in seconds.
 */
async function extrude(): Promise<void> {
  extruding.value = true
  remaining.value = null
  try {
    extruded.value = await printer.sendGcode(
      [
        'SAVE_GCODE_STATE NAME=_alabaster_rotation',
        'M83',
        `G1 E${requested.value} F60`,
        'RESTORE_GCODE_STATE NAME=_alabaster_rotation',
      ].join('\n'),
      'extrude',
      { timeoutMs: null },
    )
  } finally {
    extruding.value = false
  }
}

const history = computed(() =>
  [...calibration.historyFor('rotationDistance')].reverse().slice(0, 5),
)
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.rotationDistance.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">rotation_distance</span>
      <span>{{ current === null ? '—' : current }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.rotationDistance.detail') }}
    </p>

    <fieldset class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.method') }}</legend>
      <label class="check-row check-row--block calibration-choice__row">
        <input v-model="method" type="radio" name="extruder-rotation-method" value="measure" />
        <span>{{ t('calibration.drive.methodMeasureExtrude') }}</span>
      </label>
      <label class="check-row check-row--block calibration-choice__row">
        <input v-model="method" type="radio" name="extruder-rotation-method" value="hardware" />
        <span>{{ t('calibration.drive.methodHardware') }}</span>
      </label>
    </fieldset>

    <RotationHardwareFields
      v-if="method === 'hardware'"
      v-model:proposal="hardwareProposal"
      :drives="['driveGear']"
      initial-drive="driveGear"
      :configured="configured"
      name="extruder-rotation"
    />

    <ol v-else class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{
          t('calibration.rotation.heat', {
            current: Math.round(hotend.temperature ?? 0),
            minimum: printerConfig.minExtrudeTemperature,
          })
        }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="heatTarget"
            type="number"
            size="sm"
            :label="t('calibration.param.target')"
            :unit="t('dashboard.temperatureUnit')"
            :min="printerConfig.minExtrudeTemperature"
            :max="300"
          />
          <AppButton
            size="sm"
            :label="t('calibration.rotation.heatAction')"
            :pending="printer.pendingCommands.temperature"
            :disabled="!klipperAvailability.isAvailable || printer.hasActivePrint"
            @click="printer.setHeaterTarget('extruder', heatTarget)"
          />
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{
          t('calibration.rotation.mark', { length: marked })
        }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="marked"
            type="number"
            size="sm"
            :label="t('calibration.rotation.markLabel')"
            :unit="t('calibration.unit.millimetres')"
            :min="requested + 1"
            :max="500"
          />
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{
          t('calibration.rotation.extrude', { length: requested })
        }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="requested"
            type="number"
            size="sm"
            :label="t('calibration.rotation.lengthLabel')"
            :unit="t('calibration.unit.millimetres')"
            :min="10"
            :max="printerConfig.maxExtrudeDistance"
          />
          <AppButton
            size="sm"
            icon="play"
            :label="t('calibration.rotation.extrudeAction')"
            :pending="extruding"
            :disabled="
              !klipperAvailability.isAvailable || printer.hasActivePrint || !hotEnough || extruding
            "
            @click="extrude"
          />
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.rotation.measure') }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="remaining"
            type="number"
            size="sm"
            :label="t('calibration.rotation.remainingLabel')"
            :unit="t('calibration.unit.millimetres')"
            :min="0"
            :max="marked"
          />
        </div>
      </li>
    </ol>

    <template v-if="method === 'measure'">
      <p v-if="!hotEnough" class="calibration-panel__hint">
        {{ t('calibration.rotation.tooCold') }}
      </p>
      <p v-if="fullStepsHint !== null" class="calibration-panel__hint">
        {{
          t(
            fullStepsHint > configured.fullSteps
              ? 'calibration.drive.measure.halfExtrude'
              : 'calibration.drive.measure.doubleExtrude',
            { steps: fullStepsHint },
          )
        }}
      </p>
      <p v-if="measuredProposal && !extruded" class="calibration-panel__hint">
        {{ t('calibration.rotation.notExtruded') }}
      </p>
    </template>

    <RotationResult
      v-if="proposal"
      :configured="configured"
      :proposed="proposal"
      :targets="['extruder']"
      log-id="rotationDistance"
      :log-values="logValues"
    />

    <div v-if="history.length > 0" class="calibration-history">
      <h3 class="calibration-history__title">{{ t('calibration.bench.history') }}</h3>
      <ul class="calibration-history__list">
        <li v-for="entry in history" :key="entry.at" class="calibration-history__entry">
          <span class="calibration-history__when">{{ when(entry.at) }}</span>
          <span class="calibration-history__summary">
            rotation_distance {{ entry.rows[0]?.before }} → {{ entry.rows[0]?.after }}
          </span>
        </li>
      </ul>
    </div>
  </CalibrationCard>
</template>

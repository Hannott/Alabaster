<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import RotationHardwareFields, {
  type RotationProposal,
} from '@/components/calibration/RotationHardwareFields.vue'
import RotationResult from '@/components/calibration/RotationResult.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { useProcedureRequirements } from '@/composables/useProcedureRequirements'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  axisLetter,
  axisSteppers,
  companionSteppers,
  formatNumber,
  likelyDrive,
  measuredRotationDistance,
  stepperDrive,
  suggestedFullSteps,
} from '@/features/calibration/axisRotation'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * Rotation distance for an axis stepper, worked out two ways.
 *
 * From the hardware is the answer for a belt or a screw: the pitch and the
 * tooth count are exact, and Klipper's own guidance is to use the calculated
 * value for a belt axis rather than a measured one, since a measured move
 * mostly measures the caliper and the belt's stretch. Measuring a move is for
 * a lead screw, and for the one fault a calculation cannot see: a 0.9° motor
 * configured as 1.8°, which moves the axis exactly half as far as asked.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const context = useProcedureContext()
const requirements = useProcedureRequirements()
const { when } = useProcedureText()
const { availability: klipperAvailability } = useAvailability('klipper')

const steppers = computed(() => axisSteppers(context.value.sections))
const chosen = ref<string | null>(null)
const stepper = computed(() =>
  chosen.value !== null && steppers.value.includes(chosen.value)
    ? chosen.value
    : (steppers.value[0] ?? ''),
)

const configured = computed(() => stepperDrive(context.value.settings(stepper.value)))
const letter = computed(() => axisLetter(stepper.value, context.value.kinematics))
const drive = computed(() => likelyDrive(stepper.value, context.value.kinematics))

type Method = 'hardware' | 'measure'
const method = ref<Method>('hardware')
const effectiveMethod = computed<Method>(() => (letter.value === null ? 'hardware' : method.value))

const companions = computed(() =>
  companionSteppers(stepper.value, context.value.sections, context.value.kinematics),
)
/*
 * Ticked by default: a Z motor or a CoreXY partner left on the old value is
 * the fault this would otherwise cause, and it is the rarer printer that
 * really drives them differently.
 */
const skipped = ref<Set<string>>(new Set())
const targets = computed(() => [
  stepper.value,
  ...companions.value.filter((companion) => !skipped.value.has(companion)),
])

function setCompanion(companion: string, included: boolean): void {
  const next = new Set(skipped.value)
  if (included) next.delete(companion)
  else next.add(companion)
  skipped.value = next
}

const hardwareProposal = ref<RotationProposal | null>(null)

// The move and its measurement belong to the stepper they were made on.
const distance = ref<number | null>(10)
const measured = ref<number | null>(null)
const moved = ref(false)
const moving = ref(false)

watch(stepper, () => {
  measured.value = null
  moved.value = false
  skipped.value = new Set()
})

/*
 * A measurement is only true of the drive it was made with: once a written
 * value is running, the proposal would be worked out again from it and the
 * old reading, correcting it twice. The next reading starts from a move.
 */
watch(
  () => [configured.value.rotationDistance, configured.value.fullSteps],
  () => {
    measured.value = null
    moved.value = false
  },
)

const unmet = computed(() =>
  (['homed', 'notPrinting'] as const)
    .map((requirement) => requirements.value[requirement])
    .filter((state) => !state.met),
)

const axisIndex = computed(() => ({ X: 0, Y: 1, Z: 2 })[letter.value ?? 'X'] ?? 0)

/*
 * Relative moves only, and only ones that stay inside the limits Klipper
 * reports from where the toolhead is now. An unknown position or limit does
 * not block, the same as the probe-position check: there is nothing yet to
 * say the move is out of range, and Klipper refuses one that is.
 */
function withinLimits(sign: 1 | -1): boolean {
  const position = printer.toolheadPosition[axisIndex.value]
  const minimum = printer.buildVolume.minimum[axisIndex.value]
  const maximum = printer.buildVolume.maximum[axisIndex.value]
  const length = distance.value ?? 0
  if (typeof position !== 'number') return true
  const target = position + sign * length
  if (typeof minimum === 'number' && target < minimum) return false
  if (typeof maximum === 'number' && target > maximum) return false
  return true
}

function canMove(sign: 1 | -1): boolean {
  return (
    klipperAvailability.value.isAvailable &&
    unmet.value.length === 0 &&
    !moving.value &&
    calibration.activeRun === null &&
    !printer.pendingCommands.calibration &&
    (distance.value ?? 0) > 0 &&
    withinLimits(sign)
  )
}

const outOfRange = computed(
  () =>
    unmet.value.length === 0 && (distance.value ?? 0) > 0 && !withinLimits(1) && !withinLimits(-1),
)

/*
 * Slow, because a dial indicator is read while it moves, and a fast Z move on
 * a lead screw can skip steps — which would measure the skip rather than the
 * screw.
 */
async function move(sign: 1 | -1): Promise<void> {
  if (letter.value === null || distance.value === null) return
  moving.value = true
  measured.value = null
  try {
    const feed = letter.value === 'Z' ? 300 : 1200
    moved.value = await printer.sendGcode(
      [
        'SAVE_GCODE_STATE NAME=_alabaster_axis_rotation',
        'G91',
        `G1 ${letter.value}${formatNumber(sign * distance.value)} F${feed}`,
        'RESTORE_GCODE_STATE NAME=_alabaster_axis_rotation',
      ].join('\n'),
      'calibration',
    )
  } finally {
    moving.value = false
  }
}

const fullStepsHint = computed(() => {
  if (distance.value === null || measured.value === null) return null
  return suggestedFullSteps(configured.value.fullSteps, distance.value, measured.value)
})

const measuredProposal = computed(() => {
  const current = configured.value.rotationDistance
  if (current === null || distance.value === null || measured.value === null) return null
  const base = { gearRatio: configured.value.gearRatio, fullSteps: configured.value.fullSteps }
  if (fullStepsHint.value !== null) {
    return { ...base, rotationDistance: current, fullSteps: fullStepsHint.value }
  }
  const corrected = measuredRotationDistance(current, distance.value, measured.value)
  return corrected === null
    ? null
    : { ...base, rotationDistance: Number(formatNumber(corrected, 4)) }
})

const proposal = computed(() =>
  effectiveMethod.value === 'hardware' ? hardwareProposal.value : measuredProposal.value,
)
const logValues = computed((): Record<string, string> => {
  if (effectiveMethod.value === 'hardware')
    return { stepper: stepper.value, method: 'hardware', ...(hardwareProposal.value?.values ?? {}) }
  return {
    stepper: stepper.value,
    method: 'measure',
    commanded: String(distance.value ?? ''),
    measured: String(measured.value ?? ''),
  }
})

const summary = computed(() =>
  [
    `rotation_distance ${configured.value.rotationDistance ?? '—'}`,
    configured.value.gearRatio === '' ? null : `gear_ratio ${configured.value.gearRatio}`,
    `full_steps_per_rotation ${configured.value.fullSteps}`,
    configured.value.microsteps === null ? null : `microsteps ${configured.value.microsteps}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · '),
)

const history = computed(() => [...calibration.historyFor('axisRotation')].reverse().slice(0, 5))
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.axisRotation.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">{{ summary }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.axisRotation.detail') }}
    </p>

    <div class="calibration-params">
      <fieldset v-if="steppers.length > 1" class="calibration-choice">
        <legend class="calibration-choice__legend">{{ t('calibration.param.stepper') }}</legend>
        <label
          v-for="name in steppers"
          :key="name"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            name="axis-rotation-stepper"
            :value="name"
            :checked="stepper === name"
            @change="chosen = name"
          />
          <span>{{ name }}</span>
        </label>
      </fieldset>
      <fieldset v-if="letter !== null" class="calibration-choice">
        <legend class="calibration-choice__legend">{{ t('calibration.drive.method') }}</legend>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="method" type="radio" name="axis-rotation-method" value="hardware" />
          <span>{{ t('calibration.drive.methodHardware') }}</span>
        </label>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="method" type="radio" name="axis-rotation-method" value="measure" />
          <span>{{ t('calibration.drive.methodMeasure') }}</span>
        </label>
      </fieldset>
    </div>

    <RotationHardwareFields
      v-if="effectiveMethod === 'hardware'"
      :key="stepper"
      v-model:proposal="hardwareProposal"
      :drives="['belt', 'leadScrew']"
      :initial-drive="drive"
      :configured="configured"
      name="axis-rotation"
    />

    <template v-else>
      <p v-if="drive === 'belt'" class="calibration-panel__hint">
        {{ t('calibration.drive.measure.belt') }}
      </p>
      <ul v-if="unmet.length > 0" class="calibration-checks">
        <li
          v-for="state in unmet"
          :key="state.requirement"
          class="calibration-check calibration-check--unmet"
        >
          <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
          <span class="calibration-check__text">{{
            t(`calibration.requirement.${state.requirement}.unmet`)
          }}</span>
          <AppButton
            v-if="state.fix?.id === 'home'"
            size="xs"
            icon="home"
            :label="t('calibration.requirement.homeAll')"
            :pending="state.fix.pending"
            :disabled="!klipperAvailability.isAvailable || printer.hasActivePrint"
            @click="state.fix.run()"
          />
        </li>
      </ul>
      <ol class="calibration-steps">
        <li class="calibration-step">
          <span class="calibration-step__text">{{
            t('calibration.drive.measure.place', { axis: letter })
          }}</span>
        </li>
        <li class="calibration-step">
          <span class="calibration-step__text">{{ t('calibration.drive.measure.move') }}</span>
          <div class="calibration-step__controls">
            <AppField
              v-model="distance"
              type="number"
              size="sm"
              :label="t('calibration.drive.measure.distance')"
              :unit="t('calibration.unit.millimetres')"
              :min="1"
              :max="200"
            />
            <AppButton
              size="sm"
              :label="
                t('calibration.drive.measure.moveBy', {
                  axis: letter,
                  distance: `-${distance ?? 0}`,
                })
              "
              :pending="moving"
              :disabled="!canMove(-1)"
              @click="move(-1)"
            />
            <AppButton
              size="sm"
              :label="
                t('calibration.drive.measure.moveBy', {
                  axis: letter,
                  distance: `+${distance ?? 0}`,
                })
              "
              :pending="moving"
              :disabled="!canMove(1)"
              @click="move(1)"
            />
          </div>
        </li>
        <li class="calibration-step">
          <span class="calibration-step__text">{{ t('calibration.drive.measure.read') }}</span>
          <div class="calibration-step__controls">
            <AppField
              v-model="measured"
              type="number"
              size="sm"
              :label="t('calibration.drive.measure.measured')"
              :unit="t('calibration.unit.millimetres')"
              :min="0"
              :max="400"
            />
          </div>
        </li>
      </ol>
      <p v-if="outOfRange" class="calibration-panel__hint">
        {{ t('calibration.drive.measure.outOfRange') }}
      </p>
      <p v-if="fullStepsHint !== null" class="calibration-panel__hint">
        {{
          t(
            fullStepsHint > configured.fullSteps
              ? 'calibration.drive.measure.half'
              : 'calibration.drive.measure.double',
            { steps: fullStepsHint },
          )
        }}
      </p>
      <p v-if="measuredProposal && !moved" class="calibration-panel__hint">
        {{ t('calibration.drive.measure.notMoved') }}
      </p>
    </template>

    <fieldset v-if="companions.length > 0" class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.alsoWrite') }}</legend>
      <label
        v-for="companion in companions"
        :key="companion"
        class="check-row check-row--block calibration-choice__row"
      >
        <input
          type="checkbox"
          :checked="!skipped.has(companion)"
          @change="setCompanion(companion, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ companion }}</span>
      </label>
    </fieldset>

    <RotationResult
      v-if="proposal"
      :configured="configured"
      :proposed="proposal"
      :targets="targets"
      log-id="axisRotation"
      :log-values="logValues"
      :disabled="method === 'measure' && !moved"
    />

    <div v-if="history.length > 0" class="calibration-history">
      <h3 class="calibration-history__title">{{ t('calibration.bench.history') }}</h3>
      <ul class="calibration-history__list">
        <li v-for="entry in history" :key="entry.at" class="calibration-history__entry">
          <span class="calibration-history__when">{{ when(entry.at) }}</span>
          <span class="calibration-history__summary">
            {{ entry.values.stepper }} · rotation_distance {{ entry.rows[0]?.before }} →
            {{ entry.rows[0]?.after }}
          </span>
        </li>
      </ul>
    </div>
  </CalibrationCard>
</template>

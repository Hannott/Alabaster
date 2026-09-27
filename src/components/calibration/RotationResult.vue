<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useAvailability } from '@/composables/useAvailability'
import {
  formatNumber,
  motionResolution,
  type StepperDrive,
} from '@/features/calibration/axisRotation'
import type { ProcedureId, ProcedureResultRow } from '@/features/calibration/procedures'
import { useCalibrationStore, type PersistActionOutcome } from '@/stores/calibration'
import { useQuickConfigStore } from '@/stores/quickConfig'

/**
 * A worked-out drive set against the configured one, and the one action that
 * keeps it: writing the options that changed to the lines Klipper uses, for
 * the stepper and every companion that has to match it.
 *
 * Steps per mm and travel per step are shown beside the three options because
 * they are what changes when the step angle does — `rotation_distance` stays
 * the same between a 1.8° and a 0.9° motor, and a table of options alone would
 * make the step-angle choice look like it did nothing.
 */
const props = defineProps<{
  configured: StepperDrive
  proposed: { rotationDistance: number; gearRatio: string; fullSteps: number }
  /** Every section the values go to, the chosen stepper first. */
  targets: readonly string[]
  logId: ProcedureId
  logValues: Record<string, string>
  disabled?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const quickConfig = useQuickConfigStore()
const { availability: klipperAvailability } = useAvailability('klipper')

function resolution(drive: {
  rotationDistance: number | null
  gearRatio: string
  fullSteps: number
}) {
  if (drive.rotationDistance === null) return null
  return motionResolution({
    rotationDistance: drive.rotationDistance,
    gearRatio: drive.gearRatio,
    fullSteps: drive.fullSteps,
    microsteps: props.configured.microsteps,
  })
}

const before = computed(() => resolution(props.configured))
const after = computed(() => resolution(props.proposed))

function fixed(value: number | null | undefined, decimals: number): string {
  return value === null || value === undefined ? '' : formatNumber(value, decimals)
}

const rows = computed<ProcedureResultRow[]>(() => {
  const list: ProcedureResultRow[] = [
    {
      label: { literal: 'rotation_distance' },
      before: fixed(props.configured.rotationDistance, 4),
      after: fixed(props.proposed.rotationDistance, 4),
    },
  ]
  if (props.configured.gearRatio !== '' || props.proposed.gearRatio !== '') {
    list.push({
      label: { literal: 'gear_ratio' },
      before: props.configured.gearRatio,
      after: props.proposed.gearRatio,
    })
  }
  list.push(
    {
      label: { literal: 'full_steps_per_rotation' },
      before: String(props.configured.fullSteps),
      after: String(props.proposed.fullSteps),
    },
    {
      label: { key: 'calibration.drive.stepsPerMm' },
      before: fixed(before.value?.stepsPerMm, 3),
      after: fixed(after.value?.stepsPerMm, 3),
    },
    {
      label: { key: 'calibration.drive.fullStep' },
      before: fixed(before.value?.fullStepMm, 4),
      after: fixed(after.value?.fullStepMm, 4),
    },
  )
  if (props.configured.microsteps !== null) {
    list.push({
      label: { key: 'calibration.drive.microstep' },
      before: fixed(before.value?.microstepMm, 5),
      after: fixed(after.value?.microstepMm, 5),
    })
  }
  return list
})

function label(row: ProcedureResultRow): string {
  return 'literal' in row.label ? row.label.literal : t(row.label.key, row.label.params ?? {})
}

/*
 * The options a write would change. A gear ratio taken out is the one change
 * it cannot make: the locator writes and replaces lines but does not delete
 * them, and a rotation distance for a direct drive written under a surviving
 * ratio would be wrong by exactly that ratio.
 */
const changes = computed(() => {
  const list: { option: string; value: string }[] = []
  const distance = fixed(props.proposed.rotationDistance, 4)
  if (distance !== fixed(props.configured.rotationDistance, 4)) {
    list.push({ option: 'rotation_distance', value: distance })
  }
  if (props.proposed.gearRatio !== props.configured.gearRatio && props.proposed.gearRatio !== '') {
    list.push({ option: 'gear_ratio', value: props.proposed.gearRatio })
  }
  if (props.proposed.fullSteps !== props.configured.fullSteps) {
    list.push({ option: 'full_steps_per_rotation', value: String(props.proposed.fullSteps) })
  }
  return list
})
const removesGearRatio = computed(
  () => props.configured.gearRatio !== '' && props.proposed.gearRatio === '',
)

const writing = ref(false)
const outcome = ref<PersistActionOutcome | null>(null)
watch(
  () => [props.proposed, props.targets],
  () => (outcome.value = null),
  { deep: true },
)

/*
 * One outcome for the whole write, the least settled one: a single refused
 * line means the stepper is not what the table says, whatever else was saved.
 */
const rank: readonly PersistActionOutcome[] = ['refused', 'buffered', 'saved', 'unchanged']

async function write(): Promise<void> {
  writing.value = true
  try {
    let worst: PersistActionOutcome = 'unchanged'
    for (const section of props.targets) {
      for (const change of changes.value) {
        const result = await quickConfig.persistOption(section, change.option, change.value)
        if (rank.indexOf(result.status) < rank.indexOf(worst)) worst = result.status
        if (result.status === 'refused') break
      }
      if (worst === 'refused') break
    }
    outcome.value = worst
    if (worst !== 'refused') {
      calibration.recordManual(
        props.logId,
        { ...props.logValues, sections: props.targets.join(',') },
        rows.value.slice(0, 3),
        'measured',
      )
    }
  } finally {
    writing.value = false
  }
}
</script>

<template>
  <div class="calibration-result" role="status" aria-live="polite">
    <table class="calibration-result__table">
      <thead>
        <tr>
          <th scope="col">{{ t('calibration.result.value') }}</th>
          <th scope="col">{{ t('calibration.result.before') }}</th>
          <th scope="col">{{ t('calibration.result.now') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <th scope="row">{{ label(row) }}</th>
          <td class="calibration-result__number">{{ row.before || '—' }}</td>
          <td
            class="calibration-result__number"
            :class="{ 'calibration-result__number--changed': row.before !== row.after }"
          >
            {{ row.after || '—' }}
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="removesGearRatio" class="calibration-panel__hint">
      {{ t('calibration.drive.removeGearRatio', { section: targets[0] }) }}
    </p>
    <div v-else class="calibration-result__actions">
      <AppButton
        size="sm"
        variant="primary"
        icon="save"
        :label="t('calibration.drive.write')"
        :pending="writing"
        :disabled="disabled || changes.length === 0 || !klipperAvailability.isAvailable || writing"
        @click="write"
      />
      <span v-if="outcome" class="calibration-panel__hint">{{
        t(`calibration.result.persist.${outcome}`)
      }}</span>
      <span v-else-if="changes.length === 0" class="calibration-panel__hint">{{
        t('calibration.drive.nothingToWrite')
      }}</span>
    </div>
  </div>
</template>

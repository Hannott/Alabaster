<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import {
  beltPresets,
  beltRotationDistance,
  driveGearRotationDistance,
  formatNumber,
  gearRatioFactor,
  leadScrewPresets,
  leadScrewRotationDistance,
  type DriveKind,
  type StepperDrive,
} from '@/features/calibration/axisRotation'

export interface RotationProposal {
  rotationDistance: number
  /** As the file will spell it, '' for none. */
  gearRatio: string
  fullSteps: number
  /** What the reader entered, for the calibration log. */
  values: Record<string, string>
}

/**
 * Rotation distance worked out from what the stepper drives: a belt and
 * pulley, a lead screw, or an extruder's drive gear — plus the gear ratio and
 * the motor's step angle, which Klipper keeps in options of their own.
 *
 * Mount it keyed by the stepper: what a reader typed belongs to the stepper it
 * was typed for, and a Z screw's starts mean nothing on the X belt.
 */
const props = defineProps<{
  drives: readonly DriveKind[]
  initialDrive: DriveKind
  configured: StepperDrive
  /** Names the radio groups, which must be unique on the page. */
  name: string
}>()

const proposal = defineModel<RotationProposal | null>('proposal', { required: true })

const { t } = useI18n({ useScope: 'global' })

const drive = ref<DriveKind>(props.initialDrive)

/*
 * A catalogue of the common parts, and "Other" for the rest: the pitch of a
 * GT2 belt or the lead of a T8 screw is a fact about the part, so a reader who
 * names the part should not also have to know the number.
 */
const beltPreset = ref(beltPresets[0]!.id)
const beltPitch = ref<number | null>(2)
const teeth = ref<number | null>(20)

const screwPreset = ref(leadScrewPresets[0]!.id)
const screwPitch = ref<number | null>(2)
const starts = ref<number | null>(4)

const diameter = ref<number | null>(null)

const gearRatio = ref(props.configured.gearRatio)
const fullSteps = ref(props.configured.fullSteps)

const custom = 'custom'

const beltRows = computed(() => [
  ...beltPresets.map((preset) => ({
    value: preset.id,
    label: t(`calibration.drive.preset.${preset.id}`),
  })),
  { value: custom, label: t('calibration.drive.preset.custom') },
])
const screwRows = computed(() => [
  ...leadScrewPresets.map((preset) => ({
    value: preset.id,
    label: t(`calibration.drive.preset.${preset.id}`),
  })),
  { value: custom, label: t('calibration.drive.preset.custom') },
])

/*
 * 1.8° and 0.9° are the two motors a printer is built with; any other count
 * the config already holds stays offered as it is rather than being rewritten
 * to one of them behind the reader's back.
 */
const angleRows = computed(() => {
  const rows = [
    { value: 200, label: t('calibration.drive.angle.200') },
    { value: 400, label: t('calibration.drive.angle.400') },
  ]
  if (!rows.some((row) => row.value === props.configured.fullSteps)) {
    rows.push({
      value: props.configured.fullSteps,
      label: t('calibration.drive.angle.other', { steps: props.configured.fullSteps }),
    })
  }
  return rows
})

const gearRatioValid = computed(() => gearRatioFactor(gearRatio.value) !== null)

function num(value: number | null): number {
  return value === null ? Number.NaN : value
}

const rotationDistance = computed<number | null>(() => {
  if (drive.value === 'belt') {
    const preset = beltPresets.find((entry) => entry.id === beltPreset.value)
    return beltRotationDistance(preset?.pitch ?? num(beltPitch.value), num(teeth.value))
  }
  if (drive.value === 'leadScrew') {
    const preset = leadScrewPresets.find((entry) => entry.id === screwPreset.value)
    return preset
      ? leadScrewRotationDistance(preset.pitch, preset.starts)
      : leadScrewRotationDistance(num(screwPitch.value), num(starts.value))
  }
  return driveGearRotationDistance(num(diameter.value))
})

watchEffect(() => {
  const distance = rotationDistance.value
  if (distance === null || !gearRatioValid.value) {
    proposal.value = null
    return
  }
  const values: Record<string, string> = {
    drive: drive.value,
    gear_ratio: gearRatio.value.trim(),
    full_steps_per_rotation: String(fullSteps.value),
  }
  if (drive.value === 'belt') {
    values.belt = beltPreset.value === custom ? `${beltPitch.value ?? ''}mm` : beltPreset.value
    values.teeth = String(teeth.value ?? '')
  } else if (drive.value === 'leadScrew') {
    values.screw =
      screwPreset.value === custom
        ? `${screwPitch.value ?? ''}x${starts.value ?? ''}`
        : screwPreset.value
  } else {
    values.diameter = String(diameter.value ?? '')
  }
  proposal.value = {
    rotationDistance: Number(formatNumber(distance, 4)),
    gearRatio: gearRatio.value.trim(),
    fullSteps: fullSteps.value,
    values,
  }
})
</script>

<template>
  <div class="calibration-params">
    <fieldset v-if="drives.length > 1" class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.kind') }}</legend>
      <label
        v-for="kind in drives"
        :key="kind"
        class="check-row check-row--block calibration-choice__row"
      >
        <input v-model="drive" type="radio" :name="`${name}-drive`" :value="kind" />
        <span>{{ t(`calibration.drive.${kind}`) }}</span>
      </label>
    </fieldset>

    <fieldset v-if="drive === 'belt'" class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.beltType') }}</legend>
      <label
        v-for="row in beltRows"
        :key="row.value"
        class="check-row check-row--block calibration-choice__row"
      >
        <input v-model="beltPreset" type="radio" :name="`${name}-belt`" :value="row.value" />
        <span>{{ row.label }}</span>
      </label>
    </fieldset>

    <fieldset v-if="drive === 'leadScrew'" class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.screwType') }}</legend>
      <label
        v-for="row in screwRows"
        :key="row.value"
        class="check-row check-row--block calibration-choice__row"
      >
        <input v-model="screwPreset" type="radio" :name="`${name}-screw`" :value="row.value" />
        <span>{{ row.label }}</span>
      </label>
    </fieldset>

    <fieldset class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.drive.stepAngle') }}</legend>
      <label
        v-for="row in angleRows"
        :key="row.value"
        class="check-row check-row--block calibration-choice__row"
      >
        <input v-model="fullSteps" type="radio" :name="`${name}-angle`" :value="row.value" />
        <span>{{ row.label }}</span>
      </label>
    </fieldset>
  </div>

  <div class="calibration-params">
    <template v-if="drive === 'belt'">
      <AppField
        v-if="beltPreset === custom"
        v-model="beltPitch"
        type="number"
        size="sm"
        :label="t('calibration.drive.pitch')"
        :unit="t('calibration.unit.millimetres')"
        :min="0.5"
        :max="20"
      />
      <AppField
        v-model="teeth"
        type="number"
        size="sm"
        :label="t('calibration.drive.teeth')"
        :min="8"
        :max="120"
      />
    </template>
    <template v-else-if="drive === 'leadScrew' && screwPreset === custom">
      <AppField
        v-model="screwPitch"
        type="number"
        size="sm"
        :label="t('calibration.drive.pitch')"
        :unit="t('calibration.unit.millimetres')"
        :min="0.1"
        :max="40"
      />
      <AppField
        v-model="starts"
        type="number"
        size="sm"
        :label="t('calibration.drive.starts')"
        :min="1"
        :max="8"
      />
    </template>
    <AppField
      v-else-if="drive === 'driveGear'"
      v-model="diameter"
      type="number"
      size="sm"
      :label="t('calibration.drive.diameter')"
      :unit="t('calibration.unit.millimetres')"
      :min="1"
      :max="40"
    />
    <AppField
      v-model="gearRatio"
      type="text"
      size="sm"
      :label="t('calibration.drive.gearRatio')"
      :placeholder="t('calibration.drive.gearRatioNone')"
    />
  </div>
  <p class="calibration-panel__hint">
    {{
      gearRatioValid
        ? t('calibration.drive.gearRatioHint')
        : t('calibration.drive.gearRatioInvalid')
    }}
  </p>
  <p v-if="drive === 'driveGear'" class="calibration-panel__hint">
    {{ t('calibration.drive.diameterHint') }}
  </p>
</template>

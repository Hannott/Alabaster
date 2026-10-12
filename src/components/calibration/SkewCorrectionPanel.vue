<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import { onKlipperRestart } from '@/composables/onKlipperRestart'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureContext } from '@/composables/useProcedureContext'
import type { ProcedureResultRow } from '@/features/calibration/procedures'
import {
  isSkewProfileName,
  macrosApplySkew,
  setSkewScript,
  skewDegrees,
  skewFactor,
  skewPlanes,
  skewProfiles,
  type SkewLengths,
  type SkewPlane,
} from '@/features/calibration/skew'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * Skew correction from a printed calibration object: clear any correction,
 * print the object, measure each plane's two diagonals and one side, and save
 * the factors as a profile. A guided panel rather than a command because the
 * measurement is the reader's, taken with calipers between two steps the
 * printer does.
 *
 * The skew each set of lengths works out to is shown as it is typed, in
 * degrees: that is the number that says whether a measurement is plausible,
 * and the lengths alone say nothing until Klipper has been asked.
 */
const { t, locale } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const context = useProcedureContext()
const { availability: klipperAvailability } = useAvailability('klipper')

type Lengths = { ac: number | null; bd: number | null; ad: number | null }
const lengths = ref<Record<SkewPlane, Lengths>>({
  xy: { ac: null, bd: null, ad: null },
  xz: { ac: null, bd: null, ad: null },
  yz: { ac: null, bd: null, ad: null },
})

const profiles = computed(() => skewProfiles(context.value.sections, context.value.settings))
const profileName = ref(profiles.value[0]?.name ?? 'default')

function complete(plane: SkewPlane): SkewLengths | null {
  const { ac, bd, ad } = lengths.value[plane]
  return ac !== null && bd !== null && ad !== null ? { ac, bd, ad } : null
}

/** Each plane's skew in degrees, null while a length is missing, NaN for lengths that do not fit. */
const planeSkew = computed(
  () =>
    Object.fromEntries(
      skewPlanes.map((plane) => {
        const measured = complete(plane)
        if (measured === null) return [plane, null]
        const factor = skewFactor(measured)
        return [plane, factor === null ? Number.NaN : skewDegrees(factor)]
      }),
    ) as Record<SkewPlane, number | null>,
)

const measuredPlanes = computed(
  () =>
    Object.fromEntries(
      skewPlanes.flatMap((plane) => {
        const measured = complete(plane)
        return measured ? [[plane, measured]] : []
      }),
    ) as Partial<Record<SkewPlane, SkewLengths>>,
)

const script = computed(() => {
  const set = setSkewScript(measuredPlanes.value)
  const name = profileName.value.trim()
  if (set === null || !isSkewProfileName(name)) return null
  return `${set}\nSKEW_PROFILE SAVE=${name}`
})

const degrees = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
)

function skewText(value: number | null): string {
  if (value === null) return '—'
  if (Number.isNaN(value)) return t('calibration.skew.impossible')
  return t('calibration.skew.degrees', { value: degrees.value.format(value) })
}

const busy = ref<'clear' | 'save' | null>(null)
const cleared = ref(false)
const saved = ref(false)

/*
 * A restart loads skew from the start macro, if any, so "cleared" no longer
 * holds; and the restart that follows SAVE_CONFIG is what wrote "staged".
 */
onKlipperRestart(() => {
  cleared.value = false
  saved.value = false
})

const canSend = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    busy.value === null &&
    calibration.activeRun === null &&
    !printer.pendingCommands.calibration,
)

async function clear(): Promise<void> {
  busy.value = 'clear'
  try {
    cleared.value = await printer.sendGcode('SET_SKEW CLEAR=1', 'calibration')
  } finally {
    busy.value = null
  }
}

async function save(): Promise<void> {
  if (script.value === null) return
  busy.value = 'save'
  try {
    saved.value = await printer.sendGcode(script.value, 'calibration')
    if (!saved.value) return
    const rows: ProcedureResultRow[] = skewPlanes.flatMap((plane) => {
      const value = planeSkew.value[plane]
      return value === null || Number.isNaN(value)
        ? []
        : [{ label: { literal: plane.toUpperCase() }, after: degrees.value.format(value) }]
    })
    const values: Record<string, string> = { profile: profileName.value.trim() }
    for (const [plane, measured] of Object.entries(measuredPlanes.value)) {
      values[plane] = `${measured.ac},${measured.bd},${measured.ad}`
    }
    calibration.recordManual('skewCorrection', values, rows, 'staged')
  } finally {
    busy.value = null
  }
}

const needsLoadLine = computed(
  () => !macrosApplySkew(context.value.sections, context.value.settings),
)

function historySummary(entry: CalibrationLogEntry): string {
  const planes = entry.rows.map((row) =>
    'literal' in row.label ? `${row.label.literal} ${row.after}°` : '',
  )
  return [entry.values.profile, ...planes].filter(Boolean).join(' · ')
}
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.skewCorrection.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">SET_SKEW · SKEW_PROFILE</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.skewCorrection.detail') }}
    </p>

    <ol class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.skew.clear') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            :label="t('calibration.skew.clearAction')"
            :pending="busy === 'clear'"
            :disabled="!canSend"
            @click="clear"
          />
          <span v-if="cleared" class="calibration-panel__hint" role="status">
            {{ t('calibration.skew.cleared') }}
          </span>
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.skew.measure') }}</span>
      </li>
    </ol>

    <div class="calibration-skew">
      <fieldset v-for="plane in skewPlanes" :key="plane" class="calibration-skew__plane">
        <legend class="calibration-choice__legend">
          {{ t('calibration.skew.plane', { plane: plane.toUpperCase() }) }}
        </legend>
        <div class="calibration-skew__fields">
          <AppField
            v-for="side in ['ac', 'bd', 'ad'] as const"
            :key="side"
            v-model="lengths[plane][side]"
            type="number"
            size="sm"
            :label="side.toUpperCase()"
            :unit="t('calibration.unit.millimetres')"
            :min="1"
            :max="1000"
          />
        </div>
        <p
          class="calibration-skew__result"
          :class="{ 'calibration-skew__result--invalid': Number.isNaN(planeSkew[plane]) }"
        >
          {{ skewText(planeSkew[plane]) }}
        </p>
      </fieldset>
    </div>

    <div class="calibration-step__controls">
      <AppField
        v-model="profileName"
        type="text"
        size="sm"
        :label="t('calibration.skew.profile')"
      />
      <AppButton
        size="sm"
        variant="primary"
        icon="save"
        :label="t('calibration.skew.save')"
        :pending="busy === 'save'"
        :disabled="!canSend || script === null"
        @click="save"
      />
    </div>
    <p v-if="!isSkewProfileName(profileName.trim())" class="calibration-panel__hint" role="alert">
      {{ t('calibration.skew.profileInvalid') }}
    </p>
    <p v-if="saved" class="calibration-panel__hint" role="status">
      {{ t('calibration.result.outcome.staged') }}
    </p>
    <p v-if="needsLoadLine" class="calibration-panel__hint">
      {{ t('calibration.skew.loadLine', { name: profileName.trim() || 'default' }) }}
    </p>

    <div v-if="profiles.length > 0" class="calibration-result">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.skew.savedProfile') }}</th>
            <th v-for="plane in skewPlanes" :key="plane" scope="col">{{ plane.toUpperCase() }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="profile in profiles" :key="profile.name">
            <th scope="row">{{ profile.name }}</th>
            <td v-for="plane in skewPlanes" :key="plane" class="calibration-result__number">
              {{ degrees.format(skewDegrees(profile.factors[plane])) }}°
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <CalibrationHistory id="skewCorrection" :summary="historySummary" />
  </CalibrationCard>
</template>

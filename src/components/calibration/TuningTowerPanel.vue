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
import { formatNumber } from '@/features/calibration/axisRotation'
import { isNonlinearModel, readNpaConfig } from '@/features/calibration/nonlinearPressureAdvance'
import {
  applyScript,
  isValidSweep,
  towerScript,
  towerTargets,
  towerValue,
  type TowerTarget,
} from '@/features/calibration/tuningTower'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * A tuning tower: one print that runs a range of values, one per height, and
 * a height read off it with calipers turned back into the value it printed
 * at. Klipper's pressure advance guide is the procedure; firmware retraction's
 * length reads the same way.
 *
 * The tower is prepared here and printed from Files, like any print: what it
 * prints is the reader's own sliced object, and `TUNING_TOWER` stays armed
 * until that print starts climbing. The restart that loads a kept value is
 * also what puts the guide's slowed cornering back, so Save does both.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const context = useProcedureContext()
const { availability: klipperAvailability } = useAvailability('klipper')
const configWrite = useConfigWrite()

const targets = computed<TowerTarget[]>(() => {
  const list: TowerTarget[] = []
  if (!isNonlinearModel(readNpaConfig(context.value.settings('extruder')).model)) {
    list.push('pressureAdvance')
  }
  if (context.value.hasSection('firmware_retraction')) list.push('retractLength')
  return list
})

const chosen = ref<TowerTarget | null>(null)
const target = computed<TowerTarget>(() =>
  chosen.value !== null && targets.value.includes(chosen.value)
    ? chosen.value
    : (targets.value[0] ?? 'pressureAdvance'),
)
const info = computed(() => towerTargets[target.value])

type Setup = 'direct' | 'bowden'
const setup = ref<Setup>('direct')
const start = ref<number | null>(null)
const factor = ref<number | null>(null)
const band = ref<number | null>(null)
const height = ref<number | null>(null)
const prepared = ref(false)

/* The sweep starts from the guide's preset for the setup, and a reader's own edits replace it. */
watch(
  [target, setup],
  () => {
    const preset = info.value.presets[setup.value]
    start.value = preset.start
    factor.value = preset.factor
    band.value = preset.band
    height.value = null
    prepared.value = false
  },
  { immediate: true },
)

const sweep = computed(() => ({
  start: start.value ?? Number.NaN,
  factor: factor.value ?? Number.NaN,
  band: band.value ?? 0,
}))
const script = computed(() => towerScript(target.value, sweep.value))

const calculated = computed(() =>
  height.value === null || !isValidSweep(sweep.value)
    ? null
    : formatNumber(towerValue(sweep.value, height.value), info.value.decimals),
)

const inFile = computed(() => {
  const value = context.value.settings(info.value.section)?.[info.value.option]
  return typeof value === 'number' || typeof value === 'string' ? String(value) : null
})

const busy = ref<'prepare' | 'apply' | null>(null)
const applied = ref(false)

const canSend = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    busy.value === null &&
    calibration.activeRun === null &&
    !printer.pendingCommands.calibration,
)

async function prepare(): Promise<void> {
  if (script.value === null) return
  busy.value = 'prepare'
  try {
    prepared.value = await printer.sendGcode(script.value, 'calibration')
  } finally {
    busy.value = null
  }
}

/* A value tried between prints is live until restart, and allowed while a print runs. */
async function apply(): Promise<void> {
  if (calculated.value === null) return
  busy.value = 'apply'
  try {
    applied.value = await printer.sendGcode(
      applyScript(target.value, Number(calculated.value)),
      'calibration',
    )
  } finally {
    busy.value = null
  }
}

watch(calculated, () => {
  applied.value = false
  configWrite.forget()
})

async function save(): Promise<void> {
  if (calculated.value === null) return
  const outcome = await configWrite.write('tower', info.value.section, [
    { option: info.value.option, value: calculated.value },
  ])
  if (outcome === null || outcome === 'refused') return
  calibration.recordManual(
    'tuningTower',
    {
      target: target.value,
      start: String(sweep.value.start),
      factor: String(sweep.value.factor),
      band: String(sweep.value.band),
      height: String(height.value),
    },
    [{ label: { literal: info.value.option }, before: inFile.value, after: calculated.value }],
    'measured',
  )
}

const saveOutcome = computed(() => configWrite.outcomeFor('tower'))

function historySummary(entry: CalibrationLogEntry): string {
  const row = entry.rows[0]
  const option = row && 'literal' in row.label ? row.label.literal : ''
  return `${option} ${row?.before ?? '—'} → ${row?.after ?? '—'} · ${t('calibration.tower.atHeight', { height: entry.values.height ?? '—' })}`
}
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.tuningTower.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">{{ info.option }}</span>
      <span>{{ inFile ?? '—' }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.tuningTower.detail') }}
    </p>

    <div class="calibration-params">
      <fieldset v-if="targets.length > 1" class="calibration-choice">
        <legend class="calibration-choice__legend">{{ t('calibration.tower.target') }}</legend>
        <label
          v-for="candidate in targets"
          :key="candidate"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            name="tuning-tower-target"
            :value="candidate"
            :checked="target === candidate"
            @change="chosen = candidate"
          />
          <span>{{ t(`calibration.tower.targets.${candidate}`) }}</span>
        </label>
      </fieldset>
      <fieldset class="calibration-choice">
        <legend class="calibration-choice__legend">{{ t('calibration.tower.setup') }}</legend>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="setup" type="radio" name="tuning-tower-setup" value="direct" />
          <span>{{ t('calibration.tower.direct') }}</span>
        </label>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="setup" type="radio" name="tuning-tower-setup" value="bowden" />
          <span>{{ t('calibration.tower.bowden') }}</span>
        </label>
      </fieldset>
    </div>

    <ol class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t(`calibration.tower.slice.${target}`) }}</span>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.tower.prepare') }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="start"
            size="sm"
            :label="t('calibration.tower.start')"
            :min="0"
            :max="10"
          />
          <AppField
            v-model="factor"
            size="sm"
            :label="t('calibration.tower.factor')"
            :unit="t('calibration.tower.perMillimetre')"
            :min="0"
            :max="1"
          />
          <AppField
            v-model="band"
            size="sm"
            :label="t('calibration.tower.band')"
            :unit="t('calibration.unit.millimetres')"
            :min="0"
            :max="50"
          />
          <AppButton
            size="sm"
            icon="play"
            :label="t('calibration.tower.prepareAction')"
            :pending="busy === 'prepare'"
            :disabled="!canSend || script === null"
            @click="prepare"
          />
        </div>
        <span v-if="prepared" class="calibration-panel__hint" role="status">
          {{ t('calibration.tower.prepared') }}
        </span>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t(`calibration.tower.measure.${target}`) }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="height"
            size="sm"
            :label="t('calibration.tower.height')"
            :unit="t('calibration.unit.millimetres')"
            :min="0"
            :max="500"
          />
        </div>
      </li>
    </ol>

    <div v-if="calculated !== null" class="calibration-result" role="status" aria-live="polite">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.result.value') }}</th>
            <th scope="col">{{ t('calibration.npa.inFile') }}</th>
            <th scope="col">{{ t('calibration.npa.calculated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" class="calibration-workspace__command">{{ info.option }}</th>
            <td class="calibration-result__number">{{ inFile ?? '—' }}</td>
            <td class="calibration-result__number calibration-result__number--changed">
              {{ calculated }}
            </td>
          </tr>
        </tbody>
      </table>
      <div class="calibration-result__actions">
        <AppButton
          size="sm"
          :label="t('calibration.result.applyShapers')"
          :pending="busy === 'apply'"
          :disabled="!klipperAvailability.isAvailable || busy !== null"
          @click="apply"
        />
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.npa.saveRestart')"
          :pending="configWrite.writing.value === 'tower'"
          :disabled="configWrite.disabled.value || calculated === inFile"
          @click="save"
        />
        <span v-if="saveOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${saveOutcome}`)
        }}</span>
        <span v-else-if="applied" class="calibration-panel__hint">{{
          t('calibration.result.actionApplied')
        }}</span>
      </div>
    </div>

    <CalibrationHistory id="tuningTower" :summary="historySummary" />
  </CalibrationCard>
</template>

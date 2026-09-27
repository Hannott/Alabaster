<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureText } from '@/composables/useProcedureText'
import { rotationDistanceFrom } from '@/features/calibration/rotationDistance'
import { useCalibrationStore, type PersistActionOutcome } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useQuickConfigStore } from '@/stores/quickConfig'
import { useTelemetryStore } from '@/stores/telemetry'

/**
 * Rotation distance, measured the way the Klipper documentation describes:
 * mark the filament a known length above the extruder, extrude less than
 * that, measure what is left, and scale the configured value by how far the
 * filament actually moved.
 *
 * A guided panel rather than a form because the measurement is the reader's,
 * taken with a ruler between two steps the printer does. The new value goes to
 * the config line Klipper uses, through the same locator Quick config writes
 * with — never silently: it is offered, and it takes a firmware restart to
 * apply, which the header's restart already says.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const quickConfig = useQuickConfigStore()
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

const current = computed(() => {
  const value = printerConfig.section('extruder')?.rotation_distance
  return typeof value === 'number' && Number.isFinite(value) ? value : null
})
const hotend = computed(() => telemetry.hotend)
const hotEnough = computed(
  () => (hotend.value.temperature ?? 0) >= printerConfig.minExtrudeTemperature,
)

const proposed = computed(() =>
  current.value === null || remaining.value === null
    ? null
    : rotationDistanceFrom(current.value, requested.value, marked.value, remaining.value),
)

const extruding = ref(false)
const extruded = ref(false)

/*
 * Slowly — 1 mm/s — because a fast extrude into free air slips in the
 * extruder gears and measures the slip rather than the steps. The transport's
 * local deadline is off for the same reason the other long commands opt out:
 * this takes as long as the length in seconds.
 */
async function extrude(): Promise<void> {
  extruding.value = true
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

const writeOutcome = ref<PersistActionOutcome | null>(null)
const writing = ref(false)

async function write(): Promise<void> {
  if (proposed.value === null || current.value === null) return
  writing.value = true
  try {
    const value = proposed.value.toFixed(3)
    const result = await quickConfig.persistOption('extruder', 'rotation_distance', value)
    writeOutcome.value = result.status
    if (result.status !== 'refused') {
      calibration.recordManual(
        'rotationDistance',
        {
          requested: String(requested.value),
          marked: String(marked.value),
          remaining: String(remaining.value),
        },
        [{ label: { literal: 'rotation_distance' }, before: String(current.value), after: value }],
        'measured',
      )
    }
  } finally {
    writing.value = false
  }
}

const history = computed(() =>
  [...calibration.historyFor('rotationDistance')].reverse().slice(0, 5),
)
</script>

<template>
  <section
    class="page-card calibration-workspace"
    :aria-label="t('calibration.procedure.rotationDistance.name')"
  >
    <header class="calibration-workspace__header">
      <div class="min-w-0">
        <h2 class="calibration-workspace__title">
          {{ t('calibration.procedure.rotationDistance.name') }}
        </h2>
        <p class="calibration-workspace__meta">
          <span class="calibration-workspace__command">rotation_distance</span>
          <span>{{ current === null ? '—' : current }}</span>
        </p>
      </div>
    </header>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.rotationDistance.detail') }}
    </p>

    <ol class="calibration-steps">
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

    <p v-if="!hotEnough" class="calibration-panel__hint">{{ t('calibration.rotation.tooCold') }}</p>

    <div v-if="proposed !== null && current !== null" class="calibration-result" role="status">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.result.value') }}</th>
            <th scope="col">{{ t('calibration.result.before') }}</th>
            <th scope="col">{{ t('calibration.result.now') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">rotation_distance</th>
            <td class="calibration-result__number">{{ current }}</td>
            <td class="calibration-result__number calibration-result__number--changed">
              {{ proposed.toFixed(3) }}
            </td>
          </tr>
        </tbody>
      </table>
      <div class="calibration-result__actions">
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.result.keepInFile', { option: 'rotation_distance' })"
          :pending="writing"
          :disabled="!klipperAvailability.isAvailable || writing"
          @click="write"
        />
        <span v-if="writeOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${writeOutcome}`)
        }}</span>
      </div>
      <p v-if="!extruded" class="calibration-panel__hint">
        {{ t('calibration.rotation.notExtruded') }}
      </p>
    </div>

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
  </section>
</template>

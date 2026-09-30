<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  loadCellWord,
  loadCells,
  maximumGrams,
  minimumGrams,
  readLoadCell,
} from '@/features/calibration/loadCell'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'

/**
 * A load cell's scale, found with a known weight: Klipper's guided helper
 * tares the cell empty, reads it again under the weight, and on ACCEPT stages
 * `counts_per_gram` and `reference_tare_counts` for `SAVE_CONFIG`.
 *
 * The helper takes its steps as bare commands (`TARE`, `CALIBRATE`, `ACCEPT`,
 * `ABORT`) and answers only in console lines, so each step is a button here
 * and where the helper stands is read back from those lines — from the start
 * this panel sent, so a calibration from another session is not mistaken for
 * this one.
 */
const { t, locale } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const gcodeConsole = useConsoleStore()
const context = useProcedureContext()
const { availability: klipperAvailability } = useAvailability('klipper')

const cells = computed(() => loadCells(context.value.sections))
const chosen = ref<string | null>(null)
const cell = computed(() =>
  chosen.value !== null && cells.value.includes(chosen.value) ? chosen.value : cells.value[0]!,
)

const startedAfter = ref<number | null>(null)
const lines = computed(() => {
  const after = startedAfter.value
  if (after === null) return []
  return gcodeConsole.consoleEntries
    .filter((entry) => entry.id > after && entry.kind !== 'command')
    .map((entry) => entry.raw)
})
const reading = computed(() => readLoadCell(lines.value))
const phase = computed(() => reading.value.phase)
const isOpen = computed(
  () => phase.value === 'started' || phase.value === 'tared' || phase.value === 'calibrated',
)

const grams = ref<number | null>(null)
const busy = ref<string | null>(null)

const canSend = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    busy.value === null &&
    calibration.activeRun === null &&
    !printer.pendingCommands.calibration,
)

async function send(id: string, command: string): Promise<void> {
  busy.value = id
  try {
    await printer.sendGcode(command, 'calibration')
  } finally {
    busy.value = null
  }
}

async function start(): Promise<void> {
  const entries = gcodeConsole.consoleEntries
  startedAfter.value = entries.length > 0 ? entries[entries.length - 1]!.id : 0
  const word = loadCellWord(cell.value)
  await send('start', word === null ? 'LOAD_CELL_CALIBRATE' : `LOAD_CELL_CALIBRATE ${word}`)
}

const gramsValid = computed(
  () => grams.value !== null && grams.value >= minimumGrams && grams.value <= maximumGrams,
)

const inFile = computed(() => {
  const value = context.value.settings(cell.value)?.counts_per_gram
  return typeof value === 'number' || typeof value === 'string' ? String(value) : null
})

/* Logged once per accepted calibration, when the helper says it has staged the values. */
watch(phase, (now, before) => {
  if (now !== 'accepted' || before === 'accepted' || reading.value.countsPerGram === null) return
  calibration.recordManual(
    'loadCell',
    { section: cell.value, grams: String(grams.value ?? '') },
    [
      {
        label: { literal: 'counts_per_gram' },
        before: inFile.value,
        after: String(reading.value.countsPerGram),
      },
    ],
    'staged',
  )
})

const number = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }))

function historySummary(entry: CalibrationLogEntry): string {
  const row = entry.rows[0]
  return `${entry.values.section} · counts_per_gram ${row?.before ?? '—'} → ${row?.after ?? '—'}`
}
</script>

<template>
  <CalibrationCard class="calibration-workspace" :title="t('calibration.procedure.loadCell.name')">
    <template #aside>
      <span class="calibration-workspace__command">counts_per_gram</span>
      <span>{{ inFile ?? '—' }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.loadCell.detail') }}
    </p>

    <div class="calibration-params">
      <fieldset v-if="cells.length > 1" class="calibration-choice" :disabled="isOpen">
        <legend class="calibration-choice__legend">{{ t('calibration.loadCell.cell') }}</legend>
        <label
          v-for="candidate in cells"
          :key="candidate"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            name="load-cell"
            :value="candidate"
            :checked="cell === candidate"
            @change="chosen = candidate"
          />
          <span>[{{ candidate }}]</span>
        </label>
      </fieldset>
    </div>

    <ol class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.loadCell.start') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            icon="play"
            :label="t('calibration.loadCell.startAction')"
            :pending="busy === 'start'"
            :disabled="!canSend || isOpen"
            @click="start"
          />
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.loadCell.tare') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            :label="t('calibration.loadCell.tareAction')"
            :pending="busy === 'tare'"
            :disabled="!canSend || !isOpen"
            @click="send('tare', 'TARE')"
          />
          <span v-if="reading.tarePercent !== null" class="calibration-workspace__command">
            {{ t('calibration.loadCell.tareValue', { value: number.format(reading.tarePercent) }) }}
          </span>
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.loadCell.weigh') }}</span>
        <div class="calibration-step__controls">
          <AppField
            v-model="grams"
            size="sm"
            :label="t('calibration.loadCell.grams')"
            :unit="t('calibration.unit.grams')"
            :min="minimumGrams"
            :max="maximumGrams"
          />
          <AppButton
            size="sm"
            :label="t('calibration.loadCell.calibrateAction')"
            :pending="busy === 'calibrate'"
            :disabled="!canSend || phase === 'started' || !isOpen || !gramsValid"
            @click="send('calibrate', `CALIBRATE GRAMS=${grams}`)"
          />
        </div>
      </li>
    </ol>

    <ul v-if="reading.warnings.length > 0" class="calibration-panel__hint" role="alert">
      <li v-for="(warning, index) in reading.warnings" :key="index">{{ warning }}</li>
    </ul>

    <div
      v-if="reading.countsPerGram !== null"
      class="calibration-result"
      role="status"
      aria-live="polite"
    >
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
            <th scope="row" class="calibration-workspace__command">counts_per_gram</th>
            <td class="calibration-result__number">{{ inFile ?? '—' }}</td>
            <td class="calibration-result__number calibration-result__number--changed">
              {{ reading.countsPerGram }}
            </td>
          </tr>
          <tr v-if="reading.capacityKg !== null">
            <th scope="row">{{ t('calibration.loadCell.capacity') }}</th>
            <td class="calibration-result__number">—</td>
            <td class="calibration-result__number">
              {{
                t('calibration.loadCell.kilograms', { value: number.format(reading.capacityKg) })
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isOpen" class="calibration-result__actions">
      <AppButton
        size="sm"
        variant="primary"
        icon="check"
        :label="t('calibration.loadCell.accept')"
        :pending="busy === 'accept'"
        :disabled="!canSend || phase !== 'calibrated'"
        @click="send('accept', 'ACCEPT')"
      />
      <AppButton
        size="sm"
        :label="t('calibration.loadCell.abort')"
        :pending="busy === 'abort'"
        :disabled="!klipperAvailability.isAvailable || busy !== null"
        @click="send('abort', 'ABORT')"
      />
    </div>
    <p v-if="phase === 'accepted'" class="calibration-panel__hint" role="status">
      {{ t('calibration.result.outcome.staged') }}
    </p>
    <p v-else-if="phase === 'aborted'" class="calibration-panel__hint" role="status">
      {{ t('calibration.loadCell.aborted') }}
    </p>

    <CalibrationHistory id="loadCell" :summary="historySummary" />
  </CalibrationCard>
</template>

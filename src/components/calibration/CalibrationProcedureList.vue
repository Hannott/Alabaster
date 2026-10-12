<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/AppSelect.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { useNow } from '@/composables/useNow'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  hasRunRecord,
  isProcedureStale,
  type CalibrationProcedure,
  type ProcedureId,
} from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'

/**
 * A stage's calibrations, each a row naming what it does, when it last ran
 * on this printer, and what the printer is set to. `file-select` rows
 * composing `selection-row`, like every list the reader picks something out
 * of; below 60 rem the same choice is a `<select>`, as the stage strip above
 * it is.
 */
const props = defineProps<{
  procedures: readonly CalibrationProcedure[]
  selected: ProcedureId | null
}>()

const emit = defineEmits<{ select: [id: ProcedureId] }>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const context = useProcedureContext()
const { lastRun, text } = useProcedureText()

const now = useNow()

/** How many of a logged result's values the row has room to say. */
const valueLimit = 3

/**
 * The value line: what the last completed run found, else what the file
 * says. The log wins because it is what this printer was actually measured
 * at; the file is what it was set to, which the list can say for a procedure
 * that has never run here. A failed run found nothing, so the one before it
 * is still the measurement.
 */
function valueFor(procedure: CalibrationProcedure): string | null {
  const latest = [...calibration.historyFor(procedure.id)]
    .reverse()
    .find((entry) => calibration.outcomeOf(entry) !== 'failed' && entry.rows.length > 0)
  const found = latest?.rows.filter((row) => row.after !== '') ?? []
  if (latest && found.length > 0) {
    const shown = procedure.listRows
      ? procedure.listRows.flatMap((name) =>
          found.filter((row) => 'key' in row.label && row.label.key === name),
        )
      : found
    return (shown.length > 0 ? shown : found)
      .slice(0, valueLimit)
      .map((row) => `${text(row.label)} ${row.after}`)
      .join(' · ')
  }
  const current = procedure.current?.(context.value) ?? null
  return current === null ? null : t('calibration.bench.current', { value: current })
}

/**
 * The row's one line about its last run. A run that failed, or that the page
 * never saw finish, is said as such rather than as a date that reads like a
 * success — and it does not make the procedure current, so a row whose only
 * run failed still reads as never run.
 */
function lastFor(procedure: CalibrationProcedure): { text: string; stale: boolean } {
  const latest = calibration.latestEntry(procedure.id)
  const outcome = latest ? calibration.outcomeOf(latest) : null
  if (latest && (outcome === 'failed' || outcome === 'interrupted')) {
    return {
      text: t(`calibration.bench.${outcome}`, { when: lastRun(latest.at, now.value) }),
      stale: true,
    }
  }
  const at = calibration.lastRunAt(procedure.id)
  const stale = at === null ? false : isProcedureStale(procedure, at, now.value)
  const when = lastRun(at, now.value)
  return { text: stale ? t('calibration.bench.stale', { when }) : when, stale }
}

const rows = computed(() =>
  props.procedures.map((procedure) => {
    const last = lastFor(procedure)
    return {
      procedure,
      last: last.text,
      stale: last.stale,
      running: calibration.activeRun?.procedureId === procedure.id,
      recorded: hasRunRecord(procedure),
      value: valueFor(procedure),
    }
  }),
)

const options = computed(() =>
  props.procedures.map((procedure) => ({
    value: procedure.id,
    label: t(`calibration.procedure.${procedure.id}.name`),
  })),
)
</script>

<template>
  <CalibrationCard flush class="calibration-procedures" :title="t('calibration.bench.procedures')">
    <template #aside>{{ procedures.length }}</template>
    <ul class="calibration-procedures__list">
      <li v-for="row in rows" :key="row.procedure.id">
        <button
          type="button"
          class="file-select selection-row calibration-procedure"
          :class="{ 'selection-row--selected': row.procedure.id === selected }"
          :aria-current="row.procedure.id === selected ? 'true' : undefined"
          @click="emit('select', row.procedure.id)"
        >
          <span class="calibration-procedure__top">
            <span class="calibration-procedure__name">{{
              t(`calibration.procedure.${row.procedure.id}.name`)
            }}</span>
            <span
              v-if="row.running"
              class="calibration-procedure__last calibration-procedure__last--running"
              >{{ t('calibration.bench.running') }}</span
            >
            <span
              v-else-if="row.recorded"
              class="calibration-procedure__last"
              :class="{ 'calibration-procedure__last--stale': row.stale }"
              >{{ row.last }}</span
            >
          </span>
          <span class="calibration-procedure__description">{{
            t(`calibration.procedure.${row.procedure.id}.description`)
          }}</span>
          <span v-if="row.value" class="calibration-procedure__value">{{ row.value }}</span>
        </button>
      </li>
    </ul>
    <div class="calibration-procedures__select">
      <AppSelect
        :model-value="selected ?? ''"
        :options="options"
        :label="t('calibration.bench.procedures')"
        @update:model-value="(value) => emit('select', value as ProcedureId)"
      />
    </div>
  </CalibrationCard>
</template>

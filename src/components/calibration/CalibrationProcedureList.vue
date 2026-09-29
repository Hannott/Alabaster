<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/AppSelect.vue'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { useProcedureText } from '@/composables/useProcedureText'
import {
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

const now = Date.now()

/** How many of a logged result's values the row has room to say. */
const valueLimit = 3

/**
 * The value line: what the last logged run found, else what the file says.
 * The log wins because it is what this printer was actually measured at; the
 * file is what it was set to, which the list can say for a procedure that has
 * never run here.
 */
function valueFor(procedure: CalibrationProcedure): string | null {
  const latest = calibration.historyFor(procedure.id).at(-1)
  const found = latest?.rows.filter((row) => row.after !== '') ?? []
  if (latest && latest.outcome !== 'failed' && found.length > 0) {
    return found
      .slice(0, valueLimit)
      .map((row) => `${text(row.label)} ${row.after}`)
      .join(' · ')
  }
  const current = procedure.current?.(context.value) ?? null
  return current === null ? null : t('calibration.bench.current', { value: current })
}

const rows = computed(() =>
  props.procedures.map((procedure) => {
    const at = calibration.lastRunAt(procedure.id)
    return {
      procedure,
      last: lastRun(at, now),
      stale: at === null ? false : isProcedureStale(procedure, at, now),
      running: calibration.activeRun?.procedureId === procedure.id,
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
  <section class="page-card calibration-procedures" :aria-label="t('calibration.bench.procedures')">
    <header class="calibration-procedures__header">
      <h2 class="calibration-procedures__title">{{ t('calibration.bench.procedures') }}</h2>
      <span class="calibration-procedures__count">{{ procedures.length }}</span>
    </header>
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
              v-else
              class="calibration-procedure__last"
              :class="{ 'calibration-procedure__last--stale': row.stale }"
              >{{ row.stale ? t('calibration.bench.stale', { when: row.last }) : row.last }}</span
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
  </section>
</template>

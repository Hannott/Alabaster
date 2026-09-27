<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/AppSelect.vue'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  isProcedureStale,
  type CalibrationProcedure,
  type ProcedureId,
} from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'

/**
 * A stage's calibrations, each a row naming what it does and when it last ran
 * on this printer. `file-select` rows composing `selection-row`, like every
 * list the reader picks something out of; below 48 rem the same choice is a
 * `<select>`, as the stage strip above it is.
 */
const props = defineProps<{
  procedures: readonly CalibrationProcedure[]
  selected: ProcedureId | null
}>()

const emit = defineEmits<{ select: [id: ProcedureId] }>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const { lastRun } = useProcedureText()

const now = Date.now()

const rows = computed(() =>
  props.procedures.map((procedure) => {
    const at = calibration.lastRunAt(procedure.id)
    return {
      procedure,
      last: procedure.staleAfterDays === null && at === null ? null : lastRun(at, now),
      stale: at === null ? false : isProcedureStale(procedure, at, now),
      running: calibration.activeRun?.procedureId === procedure.id,
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
              v-else-if="row.last"
              class="calibration-procedure__last"
              :class="{ 'calibration-procedure__last--stale': row.stale }"
              >{{ row.stale ? t('calibration.bench.stale', { when: row.last }) : row.last }}</span
            >
          </span>
          <span class="calibration-procedure__description">{{
            t(`calibration.procedure.${row.procedure.id}.description`)
          }}</span>
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

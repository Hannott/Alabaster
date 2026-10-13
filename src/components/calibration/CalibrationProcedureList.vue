<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { useNow } from '@/composables/useNow'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  hasRunRecord,
  isProcedureStale,
  nextProcedure,
  type CalibrationProcedure,
  type ProcedureId,
} from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'

/**
 * A stage's calibrations, each a row naming it, when it last ran on this
 * printer, and — where there is one worth a glance — the value it is about. `file-select` rows; the
 * open one takes the list wash History, Print files and Timelapse mark
 * their rows with, rather than `selection-row`'s frame, which the owner
 * found heavier than the list around it. Below 60 rem the list is hidden
 * and the workspace's own title becomes the picker (see `CalibrationCard`).
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

/**
 * The value line, where a procedure has one worth reading at a glance: what
 * the printer is set to for a setting, or the one figure that judges a
 * measurement's newest run. A failed run found nothing, so the one before it
 * is still the measurement. Every other row is its name and its date — a
 * reader of this page knows what a probe test or a belt comparison is for,
 * and the sentence and the run's every reading under each row made the list
 * a column of text to wade through.
 */
function valueFor(procedure: CalibrationProcedure): string | null {
  if (procedure.glance) {
    const latest = [...calibration.historyFor(procedure.id)]
      .reverse()
      .find((entry) => calibration.outcomeOf(entry) !== 'failed' && entry.rows.length > 0)
    const glance = latest ? procedure.glance(latest.rows) : null
    return glance === null ? null : text(glance)
  }
  return procedure.current?.(context.value) ?? null
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
  /*
   * "Never run" beside a value the file already holds read as never
   * calibrated, on a printer tuned from the console or another interface.
   */
  if (at === null && procedure.current?.(context.value) != null) {
    return { text: t('calibration.bench.notRunHere'), stale: false }
  }
  const stale = at === null ? false : isProcedureStale(procedure, at, now.value)
  const when = lastRun(at, now.value)
  return { text: stale ? t('calibration.bench.stale', { when }) : when, stale }
}

/*
 * The step the workspace names under a result, also marked on its own row, so
 * the order the stage suggests can be read from the list without opening one.
 */
const next = computed(
  () =>
    nextProcedure(props.procedures, props.selected, (id) => calibration.lastRunAt(id), now.value)
      ?.id ?? null,
)

const rows = computed(() =>
  props.procedures.map((procedure) => {
    const last = lastFor(procedure)
    return {
      procedure,
      last: last.text,
      stale: last.stale,
      running: calibration.activeRun?.procedureId === procedure.id,
      next: procedure.id === next.value,
      recorded: hasRunRecord(procedure),
      value: valueFor(procedure),
    }
  }),
)
</script>

<template>
  <CalibrationCard flush class="calibration-procedures" :title="t('calibration.bench.procedures')">
    <template #aside>{{ procedures.length }}</template>
    <ul class="calibration-procedures__list">
      <li v-for="row in rows" :key="row.procedure.id">
        <button
          type="button"
          class="file-select calibration-procedure"
          :class="{ 'calibration-procedure--current': row.procedure.id === selected }"
          :aria-current="row.procedure.id === selected ? 'true' : undefined"
          @click="emit('select', row.procedure.id)"
        >
          <span class="calibration-procedure__top">
            <span class="calibration-procedure__name">{{
              t(`calibration.procedure.${row.procedure.id}.name`)
            }}</span>
            <span class="calibration-procedure__flags">
              <span v-if="row.next" class="calibration-procedure__next">{{
                t('calibration.bench.next.tag')
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
          </span>
          <span v-if="row.value" class="calibration-procedure__value">{{ row.value }}</span>
        </button>
      </li>
    </ul>
  </CalibrationCard>
</template>

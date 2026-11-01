<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect, { type AppSelectOption } from '@/components/AppSelect.vue'
import { runKey, type KlippyRun, type KlippyRunOutcome } from '@/features/machine/klippyLog'
import { createDateFormatter, createTimeFormatter } from '@/i18n/formats'
import { numberFormat } from '@/utils/intl'

const props = defineProps<{
  fileName: string
  view: 'run' | 'file'
  lines: readonly string[]
  runs: readonly KlippyRun[]
  selectedRun: KlippyRun | null
  /** Rows the run on screen is shown as, or null before it has been read. */
  rowCount: number | null
  hiddenStats: number
}>()

const emit = defineEmits<{ 'update:view': ['run' | 'file']; select: [key: string] }>()

const { t, locale } = useI18n()

const timeFormatter = computed(() => createTimeFormatter(locale.value))
const dateFormatter = computed(() => createDateFormatter(locale.value))

function dayOf(date: Date | null): string {
  if (!date) return t('configuration.klippyLog.run.unknownDay')
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const daysAgo = Math.round((startOfToday - startOfDay) / 86_400_000)
  if (daysAgo === 0) return t('configuration.klippyLog.run.today')
  if (daysAgo === 1) return t('configuration.klippyLog.run.yesterday')
  return dateFormatter.value.format(date)
}

/*
 * Only the last part of a reason fits a list row: `MCU 'mcu' shutdown: Phase
 * stepper move too late` reads as `Phase stepper move too late`, and the run's
 * own summary states the whole of it.
 */
function outcomeText(outcome: KlippyRunOutcome): string {
  return outcome.type === 'shutdown' || outcome.type === 'error'
    ? t(`configuration.klippyLog.outcome.${outcome.type}`, {
        reason: outcome.reason.split(': ').at(-1),
      })
    : t(`configuration.klippyLog.outcome.${outcome.type}`)
}

function timeOf(run: KlippyRun): string {
  if (!run.startedAt) return t('configuration.klippyLog.run.unknownTime')
  const time = timeFormatter.value.format(run.startedAt)
  return run.continued ? t('configuration.klippyLog.run.continuedFrom', { time }) : time
}

/** Newest first: the run a reader looks for is almost always the latest one. */
const options = computed<AppSelectOption[]>(() =>
  [...props.runs].reverse().map((run) => {
    const day = dayOf(run.startedAt)
    const time = timeOf(run)
    return {
      value: runKey(props.lines, run),
      group: day,
      label: t('configuration.klippyLog.run.option', { time, outcome: outcomeText(run.outcome) }),
      selectedLabel: t('configuration.klippyLog.run.selected', {
        day,
        time,
        outcome: t(`configuration.klippyLog.outcomeShort.${run.outcome.type}`),
      }),
    }
  }),
)

const selectedValue = computed(() =>
  props.selectedRun ? runKey(props.lines, props.selectedRun) : '',
)

const countText = computed(() => {
  if (props.rowCount === null || !props.selectedRun) return ''
  const format = numberFormat(locale.value)
  return t('configuration.klippyLog.count', {
    rows: format.format(props.rowCount),
    lines: format.format(props.selectedRun.end - props.selectedRun.start),
    stats: format.format(props.hiddenStats),
  })
})
</script>

<template>
  <div class="log-run__bar">
    <div
      class="log-run__views"
      role="group"
      :aria-label="t('configuration.klippyLog.views.label', { name: fileName })"
    >
      <button
        type="button"
        class="tab-select"
        :aria-pressed="view === 'run'"
        @click="emit('update:view', 'run')"
      >
        {{ t('configuration.klippyLog.views.run') }}
      </button>
      <button
        type="button"
        class="tab-select"
        :aria-pressed="view === 'file'"
        @click="emit('update:view', 'file')"
      >
        {{ t('configuration.klippyLog.views.file') }}
      </button>
    </div>
    <AppSelect
      v-if="view === 'run' && options.length > 0"
      class="log-run__picker"
      align="start"
      :model-value="selectedValue"
      :options="options"
      :label="t('configuration.klippyLog.run.label')"
      @update:model-value="emit('select', $event)"
    />
    <p v-if="view === 'run' && countText" class="log-run__count">{{ countText }}</p>
  </div>
</template>

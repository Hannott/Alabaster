<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { historyOutcomeIcon } from '@/features/history/outcome'
import { createDateTimeFormatter } from '@/i18n/formats'
import type { HistoryJob } from '@/stores/history'

/**
 * One row of the job list, a component rather than markup inlined into the
 * page for one reason: Vue re-renders a component, never a fragment of one.
 * With the whole list written into `HistoryView`, every reactive change on
 * that page — opening a job, a refresh setting its loading flag, the period
 * selector, a `notify_history_changed` arriving mid-print — re-ran the render
 * and the date formatting for every job the user had loaded. Measured at
 * 0.05 ms per loaded row per change: 15 ms at 300 rows and 49 ms at 1000, on
 * a desktop, for a click that changes two rows.
 *
 * Split out, Vue's own props check skips a row whose `job` reference and
 * `selected` flag are both unchanged, so that click costs two rows instead of
 * a thousand. Which is also why `select` is a declared emit rather than a
 * plain callback prop: Vue exempts declared emit listeners from that check,
 * so the parent's inline handler does not defeat it by being a new function
 * on every render.
 */
const props = defineProps<{
  job: HistoryJob
  selected: boolean
}>()

defineEmits<{ select: [] }>()

const { locale, t } = useI18n({ useScope: 'global' })

const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

const shortName = computed(() => {
  const separator = props.job.filename.lastIndexOf('/')
  return separator < 0 ? props.job.filename : props.job.filename.slice(separator + 1)
})

const when = computed(() => {
  const seconds = props.job.endedAt ?? props.job.startedAt
  if (!Number.isFinite(seconds) || seconds <= 0) return t('history.noValue')
  return dateFormatter.value.format(seconds * 1000)
})
</script>

<template>
  <button
    type="button"
    class="file-select history-job"
    :class="{ 'history-job--selected': selected }"
    :aria-current="selected ? 'true' : undefined"
    @click="$emit('select')"
  >
    <!-- Word and shape, never the colour alone. -->
    <span class="history-job__outcome" :class="`history-job__outcome--${job.outcome}`">
      <AppIcon :name="historyOutcomeIcon(job.outcome)" class="size-3.5" aria-hidden="true" />
      {{ t(`history.outcome.${job.outcome}`) }}
    </span>
    <span class="history-job__name" :title="job.filename">{{ shortName }}</span>
    <span class="history-job__when">{{ when }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import type { ActionGuardResult } from '@/composables/useActionGuard'
import { formatHistoryDuration, formatHistoryFilament } from '@/features/history/format'
import { historyOutcomeIcon } from '@/features/history/outcome'
import type { HistoryJob } from '@/stores/history'

/**
 * One row of the job list, a component rather than markup inlined into the
 * page for one reason: Vue re-renders a component, never a fragment of one.
 * With the whole list written into `HistoryView`, every reactive change on
 * that page — opening a job, a refresh setting its loading flag, the period
 * selector, a `notify_history_changed` arriving mid-print — re-ran the render
 * and the formatting for every job the user had loaded. Measured at 0.05 ms
 * per loaded row per change: 15 ms at 300 rows and 49 ms at 1000, on a
 * desktop, for a click that changes two rows.
 *
 * Split out, Vue's own props check skips a row whose props are all unchanged,
 * so that click costs two rows instead of a thousand. Which is also why every
 * action is a declared emit rather than a plain callback prop: Vue exempts
 * declared emit listeners from that check, so the parent's inline handlers do
 * not defeat it by being new functions on every render. The guards are passed
 * in for the same reason — one shared object per page, not one per row.
 */
const props = defineProps<{
  job: HistoryJob
  selected: boolean
  thumbnailUrl: string | null
  /** The time of day the row shows; the day itself is its group's label. */
  time: string
  canReprint: boolean
  canQueue: boolean
  canDelete: boolean
  reprintGuard: ActionGuardResult
  deleteGuard: ActionGuardResult
}>()

defineEmits<{ select: []; reprint: []; queue: []; remove: [] }>()

const { locale, t } = useI18n({ useScope: 'global' })

/** The file's own name, without its folders or the `.gcode` every row would repeat. */
const name = computed(() => {
  const separator = props.job.filename.lastIndexOf('/')
  const base = separator < 0 ? props.job.filename : props.job.filename.slice(separator + 1)
  return base.replace(/\.gcode$/i, '')
})

const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

/**
 * When it ended, how it ended if not cleanly, how long it printed, and what it
 * used: the four things a reader scans a day's jobs for. A job that went wrong
 * says so here as well as in its status, because on a phone the status keeps
 * only its glyph.
 */
const meta = computed(() => {
  const { job } = props
  // The file's own weight is what a finished print used; a job that stopped
  // early used only what Moonraker measured, so it never borrows the plan's.
  const filament =
    job.outcome === 'completed' && job.details.filamentWeight
      ? [
          t('history.jobs.detail.weight', {
            value: weightFormatter.value.format(job.details.filamentWeight),
          }),
          job.details.filamentType,
        ]
          .filter(Boolean)
          .join(' ')
      : job.filamentUsed > 0
        ? formatHistoryFilament(job.filamentUsed, t, locale.value)
        : null
  return [
    props.time,
    job.outcome === 'completed' ? null : t(`history.outcome.${job.outcome}`),
    job.printDuration > 0 ? formatHistoryDuration(job.printDuration, t) : null,
    filament,
  ]
    .filter((part): part is string => Boolean(part))
    .reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
})
</script>

<template>
  <div
    class="history-job machine-row"
    :class="{ 'machine-row--open': selected }"
    :data-state="
      job.outcome === 'completed' || job.outcome === 'cancelled' ? 'current' : 'attention'
    "
  >
    <button
      type="button"
      class="file-select machine-row__toggle"
      :aria-expanded="selected"
      :aria-controls="`history-job-${job.id}`"
      @click="$emit('select')"
    >
      <img
        v-if="thumbnailUrl"
        class="machine-row__thumb"
        :src="thumbnailUrl"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span v-else class="machine-row__thumb" aria-hidden="true"></span>
      <span class="machine-row__detail" :title="job.filename">
        <span class="machine-row__name machine-row__name--identifier">{{ name }}</span>
        <span class="machine-row__meta">{{ meta }}</span>
      </span>
    </button>
    <!-- Word and shape, never the color alone. -->
    <span
      class="machine-row__status history-job__outcome"
      :class="`history-job__outcome--${job.outcome}`"
    >
      <AppIcon :name="historyOutcomeIcon(job.outcome)" class="size-4" aria-hidden="true" />
      <span class="history-job__outcome-label">{{ t(`history.outcome.${job.outcome}`) }}</span>
    </span>
    <HeaderMenu
      class="machine-row__menu"
      :label="t('history.jobs.moreActions', { name })"
      align="end"
      trigger-size="sm"
      trigger-icon-only
    >
      <template #trigger>
        <AppIcon name="more" class="size-5" aria-hidden="true" />
      </template>
      <template #default="{ close }">
        <AppButton
          size="sm"
          start
          block
          icon="print"
          class="history-job__reprint"
          :guard="reprintGuard"
          :label="t('history.jobs.reprint')"
          :disabled="!canReprint || !job.fileExists"
          :title="job.fileExists ? undefined : t('history.jobs.fileGone')"
          @click="
            () => {
              $emit('reprint')
              close()
            }
          "
        />
        <AppButton
          variant="quiet"
          size="sm"
          start
          block
          icon="jobs"
          class="history-job__queue"
          :label="t('history.jobs.detail.addToQueue')"
          :disabled="!canQueue || !job.fileExists"
          :title="job.fileExists ? undefined : t('history.jobs.fileGone')"
          @click="
            () => {
              $emit('queue')
              close()
            }
          "
        />
        <AppButton
          size="sm"
          start
          block
          icon="trash"
          class="history-job__remove"
          :guard="deleteGuard"
          :label="t('history.jobs.delete')"
          :disabled="!canDelete"
          @click="
            () => {
              $emit('remove')
              close()
            }
          "
        />
      </template>
    </HeaderMenu>
  </div>
</template>

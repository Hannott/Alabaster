<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { formatHistoryDuration } from '@/features/history/format'
import {
  gcodeDisplayName,
  listThumbnailPath,
  moonrakerThumbnailUrl,
  type MoonrakerGcodeMetadata,
} from '@/services/moonraker'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

/**
 * The print queue beside the files it is filled from, so "Add to queue" lands
 * somewhere the reader can see. The same management the JobQueue card offers —
 * start, pause, remove, clear — because a queue shown without its controls
 * would send the reader to the dashboard to act on what they are looking at.
 */
const { locale, t } = useI18n({ useScope: 'global' })
const jobQueue = useJobQueueStore()
const printer = usePrinterStore()
const moonraker = useMoonrakerStore()
const confirmations = useConfirmationsStore()

/*
 * A queued job names only its file, so its picture and estimate come from the
 * printer store's per-file metadata cache — the same answer the Print card and
 * the file list's open row get, and one request per file at most.
 */
const metadata = reactive(new Map<string, MoonrakerGcodeMetadata | null>())
watch(
  () => jobQueue.jobs.map((job) => job.filename),
  (filenames) => {
    for (const filename of new Set(filenames)) {
      if (metadata.has(filename)) continue
      metadata.set(filename, null)
      void printer.loadMetadata(filename).then((result) => metadata.set(filename, result))
    }
  },
  { immediate: true },
)

const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

const rows = computed(() =>
  jobQueue.jobs.map((job) => {
    const details = metadata.get(job.filename) ?? null
    const thumbnail = listThumbnailPath(details?.thumbnails)
    let thumbnailUrl: string | null = null
    if (thumbnail) {
      try {
        thumbnailUrl = moonrakerThumbnailUrl(job.filename, thumbnail, moonraker.endpoint)
      } catch {
        thumbnailUrl = null
      }
    }
    const meta = [
      details?.estimated_time ? formatHistoryDuration(details.estimated_time, t) : null,
      details?.filament_weight_total
        ? t('history.jobs.detail.weight', {
            value: weightFormatter.value.format(details.filament_weight_total),
          })
        : null,
    ].filter((part): part is string => Boolean(part))
    const color = details?.filament_colors?.[0]
    return {
      job,
      name: gcodeDisplayName(job.filename),
      thumbnailUrl,
      meta: meta.length
        ? meta.reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
        : '',
      material: details?.filament_type?.split(/[,;]/)[0]?.trim() || null,
      color: typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
      estimate: details?.estimated_time ?? null,
    }
  }),
)

/** The state, how many, and how long they take together — the last only when every job has an estimate. */
const summary = computed(() => {
  if (jobQueue.jobs.length === 0) return t('dashboard.jobQueue.empty')
  const parts = [
    t(`printFiles.queue.state.${jobQueue.queueState}`),
    t('printFiles.queue.jobs', { count: jobQueue.jobs.length }),
  ]
  const estimates = rows.value.map((row) => row.estimate)
  if (estimates.every((estimate): estimate is number => typeof estimate === 'number')) {
    parts.push(
      formatHistoryDuration(
        estimates.reduce((sum, value) => sum + value, 0),
        t,
      ),
    )
  }
  return parts.reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
})

const clearQueueGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  key: 'clearJobQueue',
})
const confirmingClear = ref(false)

function requestClearQueue(): void {
  clearQueueGuard.request(
    () => void jobQueue.clearQueue(),
    () => (confirmingClear.value = true),
  )
}

function confirmClearQueue(): void {
  confirmingClear.value = false
  void jobQueue.clearQueue()
}
</script>

<template>
  <section
    class="machine-status-panel machine-list-panel print-queue-panel"
    aria-labelledby="print-queue-heading"
  >
    <header class="machine-panel-heading">
      <AppIcon name="jobs" class="size-5 text-action" aria-hidden="true" />
      <h2 id="print-queue-heading">{{ t('printFiles.queue.title') }}</h2>
      <div class="machine-panel-heading__actions">
        <AppButton
          v-if="jobQueue.isPaused"
          size="sm"
          icon="play"
          :label="t('dashboard.jobQueue.start')"
          :disabled="jobQueue.pendingCommands.start || jobQueue.jobs.length === 0"
          @click="jobQueue.startQueue()"
        />
        <AppButton
          v-else
          size="sm"
          icon="pause"
          :label="t('dashboard.jobQueue.pause')"
          :disabled="jobQueue.pendingCommands.pause"
          @click="jobQueue.pauseQueue()"
        />
        <HeaderMenu
          :label="t('printFiles.queue.moreActions')"
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
              class="print-queue__clear"
              :guard="clearQueueGuard"
              :label="t('dashboard.jobQueue.clear')"
              :disabled="jobQueue.pendingCommands.clear || jobQueue.jobs.length === 0"
              @click="
                () => {
                  requestClearQueue()
                  close()
                }
              "
            />
          </template>
        </HeaderMenu>
      </div>
    </header>
    <p class="machine-panel-summary">{{ summary }}</p>
    <div v-if="rows.length > 0" class="machine-list machine-list--media">
      <div v-for="row in rows" :key="row.job.job_id" class="machine-row print-queue-job">
        <img
          v-if="row.thumbnailUrl"
          class="machine-row__thumb"
          :src="row.thumbnailUrl"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span v-else class="machine-row__thumb" aria-hidden="true"></span>
        <span class="machine-row__detail" :title="row.job.filename">
          <span class="machine-row__name machine-row__name--identifier">{{ row.name }}</span>
          <span class="machine-row__meta">{{ row.meta }}</span>
        </span>
        <span v-if="row.material" class="machine-row__status print-file__material">
          <span
            v-if="row.color"
            class="filament-chip__swatch"
            :style="{ backgroundColor: row.color }"
            aria-hidden="true"
          ></span>
          <span class="print-file__material-label">{{ row.material }}</span>
        </span>
        <AppButton
          variant="quiet"
          size="sm"
          icon-only
          icon="close"
          class="machine-row__menu"
          :disabled="jobQueue.pendingCommands.remove"
          :aria-label="t('dashboard.jobQueue.remove', { filename: row.name })"
          :title="t('dashboard.jobQueue.remove', { filename: row.name })"
          @click="jobQueue.removeJob(row.job.job_id)"
        />
      </div>
    </div>
    <p v-if="jobQueue.failed" class="print-files-note" role="alert">
      {{ t('dashboard.jobQueue.loadFailed') }}
    </p>

    <ConfirmDialog
      :open="confirmingClear"
      :title="t('dashboard.jobQueue.clearConfirmTitle')"
      :description="t('dashboard.jobQueue.clearConfirm')"
      :confirm-label="t('dashboard.jobQueue.clear')"
      tone="danger"
      show-skip-option
      @confirm="confirmClearQueue"
      @cancel="confirmingClear = false"
      @skip="confirmations.setSkip('clearJobQueue', true)"
    />
  </section>
</template>

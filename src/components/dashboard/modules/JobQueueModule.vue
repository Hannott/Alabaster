<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import FileDropOverlay from '@/components/FileDropOverlay.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useExternalFileDrop } from '@/composables/useExternalFileDrop'
import { useDashboardModule } from '@/dashboard/context'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterStore } from '@/stores/printer'

const { t } = useI18n({ useScope: 'global' })
const { isSettingsOpen } = useDashboardModule('jobQueue')
const jobQueue = useJobQueueStore()
const printer = usePrinterStore()

const stateLabel = computed(() => t(`dashboard.jobQueue.state.${jobQueue.queueState}`))

/*
 * Tier 3a, not 3b: clearing the queue destroys the list on its own terms and
 * Klipper offers nothing that puts it back, so the consequence does not depend
 * on whether something is printing. A job already on the plate is untouched --
 * which is exactly why gating this on print state would have been wrong.
 */
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

function filename(path: string): string {
  const separatorIndex = path.lastIndexOf('/')
  return separatorIndex < 0 ? path : path.slice(separatorIndex + 1)
}

/**
 * A drop is the one place this card adds to the queue rather than only
 * managing it (see `docs/design/navigation-plan.md`'s "enqueue only from
 * Print files" rule, and the exception carved for a desktop file drop): the
 * file being enqueued is whatever the drag is carrying, not something picked
 * from a list on this card, so the rule's own reasoning does not apply here.
 * Each file uploads to Print files, then queues in the order it was dropped.
 */
const {
  isActive: isFileDropActive,
  onDragEnter: onFileDragEnter,
  onDragOver: onFileDragOver,
  onDragLeave: onFileDragLeave,
  onDrop: onFileDrop,
} = useExternalFileDrop({
  canDrop: () => !printer.pendingCommands.uploadFile && !jobQueue.pendingCommands.add,
  onDrop: async (files) => {
    for (const file of files) {
      const path = await printer.uploadPrintFile(file)
      if (path) await jobQueue.addJob(path)
    }
  },
})
</script>

<template>
  <!--
    inset: the drop target and its overlay are this module's own padded box,
    not the shell's. Taking the shell's padding instead would inset the
    overlay by 1rem and leave a border of card that reads as outside the drop
    zone while still accepting the drop — the same reason `PrintModule` keeps
    its own `p-4` on `print-card`.
  -->
  <AppDashboardModule inset :open="isSettingsOpen">
    <div
      class="relative grid gap-3 p-4"
      @dragenter="onFileDragEnter"
      @dragover="onFileDragOver"
      @dragleave="onFileDragLeave"
      @drop="onFileDrop"
    >
      <FileDropOverlay v-if="isFileDropActive" :message="t('dashboard.jobQueue.dropHint')" />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="text-eyebrow text-data-sky">
            {{ stateLabel }}
          </p>
          <p class="mt-1 text-card-title">
            {{ t('dashboard.jobQueue.count', { count: jobQueue.jobs.length }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <AppButton
            v-if="jobQueue.isPaused"
            variant="primary"
            icon="play"
            :label="t('dashboard.jobQueue.start')"
            :disabled="jobQueue.pendingCommands.start || jobQueue.jobs.length === 0"
            @click="jobQueue.startQueue()"
          />
          <AppButton
            v-else
            size="sm"
            :disabled="jobQueue.pendingCommands.pause"
            icon="pause"
            :label="t('dashboard.jobQueue.pause')"
            @click="jobQueue.pauseQueue()"
          />
          <AppButton
            size="sm"
            :guard="clearQueueGuard"
            :label="t('dashboard.jobQueue.clear')"
            :disabled="jobQueue.pendingCommands.clear || jobQueue.jobs.length === 0"
            @click="requestClearQueue()"
          />
        </div>
      </div>

      <ol v-if="jobQueue.jobs.length > 0" class="grid gap-1">
        <li v-for="(job, index) in jobQueue.jobs" :key="job.job_id" class="queue-row">
          <span class="queue-row__position text-value">
            {{ index + 1 }}
          </span>
          <span class="min-w-0 truncate text-row-name" :title="job.filename">
            {{ filename(job.filename) }}
          </span>
          <AppButton
            variant="danger-quiet"
            size="xs"
            icon-only
            icon="close"
            :disabled="jobQueue.pendingCommands.remove"
            :aria-label="t('dashboard.jobQueue.remove', { filename: filename(job.filename) })"
            :title="t('dashboard.jobQueue.remove', { filename: filename(job.filename) })"
            @click="jobQueue.removeJob(job.job_id)"
          />
        </li>
      </ol>
      <p v-else class="text-xs text-muted">{{ t('dashboard.jobQueue.empty') }}</p>

      <p v-if="jobQueue.failed" class="text-alert-inline" role="alert">
        {{ t('dashboard.jobQueue.loadFailed') }}
      </p>
    </div>

    <ConfirmDialog
      :open="confirmingClear"
      :title="t('dashboard.jobQueue.clearConfirmTitle')"
      :description="t('dashboard.jobQueue.clearConfirm')"
      :confirm-label="t('dashboard.jobQueue.clear')"
      tone="danger"
      @confirm="confirmClearQueue"
      @cancel="confirmingClear = false"
    />
  </AppDashboardModule>
</template>
